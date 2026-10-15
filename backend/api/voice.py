import os
import json
import base64
import asyncio
import logging
import uuid
from typing import Optional, Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import User, async_session_maker, SQLAlchemyUserDatabase
from backend.core.users import UserManager, get_jwt_strategy, SECRET
from backend.services.voice.stt import transcribe_voice_utterance
from backend.services.voice.llm import stream_voice_llm_chunks
from backend.services.voice.tts import synthesize_voice_chunk, TTSFallbackException
from backend.services.voice.session_manager import voice_registry, VoiceSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["Voice Agent"])

async def authenticate_websocket_token(token: str) -> Optional[User]:
    """Validates JWT access token and returns the authenticated User record."""
    try:
        strategy = get_jwt_strategy()
        async with async_session_maker() as session:
            user_db = SQLAlchemyUserDatabase(session, User)
            user_manager = UserManager(user_db)
            user = await strategy.read_token(token, user_manager)
            if user and user.is_active:
                return user
    except Exception as e:
        logger.warning(f"WebSocket token authentication failure: {e}")
    return None

async def run_voice_turn(
    websocket: WebSocket,
    session: VoiceSession,
    user: User,
    turn_id: int,
    wav_bytes: bytes
):
    """Executes a single conversational voice turn: STT -> Quota -> LLM -> TTS Stream."""
    try:
        await websocket.send_text(json.dumps({
            "type": "turn_start",
            "turn_id": turn_id
        }))

        # 1. Speech-to-Text
        stt_result = await transcribe_voice_utterance(wav_bytes)

        if not stt_result["is_valid"]:
            await websocket.send_text(json.dumps({
                "type": "turn_discarded",
                "turn_id": turn_id,
                "reason": stt_result["reason"]
            }))
            return

        # 2. Check and deduct quota
        is_allowed, sec_left, trn_left = await voice_registry.check_and_update_quota(
            user.id,
            seconds_to_add=stt_result["duration_seconds"],
            turns_to_add=1
        )
        if not is_allowed:
            await websocket.send_text(json.dumps({
                "type": "quota_exceeded",
                "turn_id": turn_id,
                "message": "Daily voice quota reached. Please continue in standard chat."
            }))
            return

        # 3. Emit user transcript
        user_text = stt_result["text"]
        await websocket.send_text(json.dumps({
            "type": "transcript",
            "turn_id": turn_id,
            "role": "user",
            "text": user_text,
            "seconds_left": sec_left,
            "turns_left": trn_left
        }))
        session.add_history("user", user_text)

        # 4. Stream LLM chunks & parallelize TTS
        full_assistant_text = ""
        seq = 1
        lang = stt_result.get("language", "en")

        async for chunk_text in stream_voice_llm_chunks(session.history, user_text, language=lang):
            full_assistant_text = f"{full_assistant_text} {chunk_text}".strip()

            try:
                audio_bytes = await synthesize_voice_chunk(chunk_text, language=lang)
                b64_audio = base64.b64encode(audio_bytes).decode("ascii")

                await websocket.send_text(json.dumps({
                    "type": "audio_chunk",
                    "turn_id": turn_id,
                    "seq": seq,
                    "text": chunk_text,
                    "audio": b64_audio
                }))
            except TTSFallbackException as tts_err:
                logger.warning(f"TTS fallback triggered for turn {turn_id} seq {seq}: {tts_err}")
                await websocket.send_text(json.dumps({
                    "type": "tts_fallback",
                    "turn_id": turn_id,
                    "seq": seq,
                    "text": chunk_text
                }))

            seq += 1

        # 5. Finalize turn
        await websocket.send_text(json.dumps({
            "type": "turn_complete",
            "turn_id": turn_id,
            "assistant_transcript": full_assistant_text,
            "seconds_left": sec_left,
            "turns_left": trn_left
        }))
        session.add_history("assistant", full_assistant_text)

    except asyncio.CancelledError:
        logger.info(f"Voice turn {turn_id} task was cancelled due to user interruption.")
    except Exception as e:
        logger.error(f"Error executing voice turn {turn_id}: {e}")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "turn_id": turn_id,
                "code": "llm_unavailable",
                "message": "Voice processing encountered a temporary issue. Please try speaking again."
            }))
        except Exception:
            pass

@router.websocket("/stream")
async def voice_stream_endpoint(websocket: WebSocket):
    """
    Real-time bidirectional WebSocket endpoint for Voice Mode.
    Protocol:
    1. Initial handshake: Client sends {"type": "auth", "token": "<JWT>"} within 5.0 seconds.
    2. Server verifies token and returns {"type": "auth_ok", "session_id": "...", "seconds_left": X}.
    3. Client sends binary frames of 16kHz WAV utterances preceded by JSON header.
    4. Client can send {"type": "interrupt", "turn_id": X} to halt audio immediately.
    """
    await websocket.accept()
    user: Optional[User] = None
    session: Optional[VoiceSession] = None

    # Step 1: Handshake with 5-second timeout
    try:
        raw_auth = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
        auth_data = json.loads(raw_auth)
        if auth_data.get("type") != "auth" or not auth_data.get("token"):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing auth handshake.")
            return

        user = await authenticate_websocket_token(auth_data["token"])
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired access token.")
            return

    except (asyncio.TimeoutError, json.JSONDecodeError):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Handshake timeout or invalid payload.")
        return

    # Step 2: Register active session & check initial quota
    session = await voice_registry.register_session(user.id)
    is_allowed, sec_left, trn_left = await voice_registry.check_and_update_quota(user.id)

    if not is_allowed:
        await websocket.send_text(json.dumps({
            "type": "quota_exceeded",
            "message": "Daily voice quota reached. Please use normal chat mode."
        }))
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Daily quota exceeded.")
        return

    await websocket.send_text(json.dumps({
        "type": "auth_ok",
        "session_id": str(session.session_id),
        "seconds_left": sec_left,
        "turns_left": trn_left
    }))

    # Step 3: Message loop
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            # Handle text JSON messages
            if "text" in message:
                try:
                    payload = json.loads(message["text"])
                    msg_type = payload.get("type")

                    if msg_type == "user_audio_header":
                        session.last_audio_header = payload

                    elif msg_type == "interrupt":
                        turn_id = payload.get("turn_id")
                        session.cancel_active_turn(turn_id)
                        await websocket.send_text(json.dumps({
                            "type": "interrupted",
                            "turn_id": turn_id
                        }))

                    elif msg_type == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))

                except json.JSONDecodeError:
                    pass

            # Handle binary WAV audio frame
            elif "bytes" in message:
                wav_bytes = message["bytes"]
                header = session.last_audio_header or {}
                turn_id = header.get("turn_id", 1)

                # Cancel any previous active turn
                session.cancel_active_turn()

                # Launch async turn task
                session.active_turn_id = turn_id
                session.active_turn_task = asyncio.create_task(
                    run_voice_turn(websocket, session, user, turn_id, wav_bytes)
                )

    except WebSocketDisconnect:
        logger.info(f"Voice WebSocket disconnected for user {user.id}")
    except Exception as e:
        logger.error(f"Unexpected voice WebSocket error for user {user.id}: {e}")
    finally:
        if session and user:
            await voice_registry.unregister_session(user.id, session.session_id)
