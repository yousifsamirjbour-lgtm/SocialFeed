import os
import json
import base64
import asyncio
import logging
import uuid
import re
from typing import Optional, Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import User, async_session_maker, SQLAlchemyUserDatabase
from backend.core.users import UserManager, get_jwt_strategy, SECRET
from backend.services.voice.stt import transcribe_voice_utterance
from backend.services.voice.llm import stream_voice_llm_chunks
from backend.services.voice.tts import synthesize_voice_chunk, TTSFallbackException, is_arabic
from backend.services.voice.session_manager import voice_registry, VoiceSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["Voice Agent"])

async def authenticate_websocket_token(token: Optional[str]) -> Optional[User]:
    """Validates JWT access token and returns the authenticated User record."""
    if not token or not isinstance(token, str):
        return None
    try:
        clean_token = token.removeprefix("Bearer ").strip()
        strategy = get_jwt_strategy()
        async with async_session_maker() as session:
            user_db = SQLAlchemyUserDatabase(session, User)
            user_manager = UserManager(user_db)
            user = await strategy.read_token(clean_token, user_manager)
            if user and user.is_active:
                return user
    except Exception as e:
        logger.warning(f"WebSocket token authentication failure: {e}")
    return None

try:
    from langsmith import traceable
except ImportError:
    def traceable(*args, **kwargs):
        def decorator(f):
            return f
        return decorator

@traceable(name="voice_turn", run_type="chain")
async def run_voice_turn(
    websocket: WebSocket,
    session: VoiceSession,
    user: User,
    turn_id: int,
    wav_bytes: bytes
):
    """Executes a single conversational voice turn: STT -> Quota -> Concurrent LLM Stream & Background TTS."""
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

        # 3. Emit user transcript with deterministic turn language lock
        user_text = stt_result["text"]
        detected_lang = stt_result.get("language", "en")
        is_ar_turn = is_arabic(user_text) or str(detected_lang).lower().startswith("ar")
        turn_lang = "ar" if is_ar_turn else "en"

        await websocket.send_text(json.dumps({
            "type": "transcript",
            "turn_id": turn_id,
            "role": "user",
            "text": user_text,
            "language": turn_lang,
            "seconds_left": sec_left,
            "turns_left": trn_left
        }))
        session.add_history("user", user_text)

        # 4. Stream LLM chunks & dispatch TTS synthesis concurrently in background tasks
        full_assistant_text_parts = []
        chunk_queue: asyncio.Queue = asyncio.Queue()

        async def synthesize_worker(sequence_num: int, text_content: str):
            try:
                audio_bytes = await synthesize_voice_chunk(text_content, language=turn_lang)
                b64_audio = base64.b64encode(audio_bytes).decode("ascii")
                return {
                    "type": "audio_chunk",
                    "turn_id": turn_id,
                    "seq": sequence_num,
                    "text": text_content,
                    "language": turn_lang,
                    "audio": b64_audio
                }
            except Exception as tts_err:
                logger.warning(f"TTS fallback triggered for turn {turn_id} seq {sequence_num}: {tts_err}")
                return {
                    "type": "tts_fallback",
                    "turn_id": turn_id,
                    "seq": sequence_num,
                    "language": turn_lang,
                    "text": text_content
                }

        async def stream_and_dispatch():
            seq = 1
            try:
                async for chunk_text in stream_voice_llm_chunks(session.history, user_text, language=turn_lang):
                    full_assistant_text_parts.append(chunk_text)
                    # Dispatch TTS task concurrently in background
                    task = asyncio.create_task(synthesize_worker(seq, chunk_text))
                    await chunk_queue.put(task)
                    seq += 1
            finally:
                # Sentinel to indicate LLM generation complete
                await chunk_queue.put(None)

        producer_task = asyncio.create_task(stream_and_dispatch())

        try:
            while True:
                task = await chunk_queue.get()
                if task is None:
                    break
                payload = await task
                await websocket.send_text(json.dumps(payload))
            await producer_task
        except asyncio.CancelledError:
            producer_task.cancel()
            raise

        full_assistant_text = " ".join(full_assistant_text_parts).strip()

        # 5. Finalize turn
        await websocket.send_text(json.dumps({
            "type": "turn_complete",
            "turn_id": turn_id,
            "language": turn_lang,
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
async def voice_stream_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None)
):
    """
    Real-time bidirectional WebSocket endpoint for Voice Mode.
    Protocol:
    1. Initial handshake: Client passes token via query parameter (?token=<JWT>)
       OR sends in-band JSON {"type": "auth", "token": "<JWT>"} within 5.0 seconds.
    2. Server verifies token and returns {"type": "auth_ok", "session_id": "...", "seconds_left": X}.
    3. Client sends binary frames of 16kHz WAV utterances preceded by JSON header.
    4. Client can send {"type": "interrupt", "turn_id": X} to halt audio immediately.
    """
    user: Optional[User] = None
    session: Optional[VoiceSession] = None

    # Step 1: Handshake Authentication
    auth_token = token or websocket.query_params.get("token")
    if auth_token:
        # Browser WebSocket API limitation: Cannot send custom Authorization headers.
        # Token is passed during the HTTP Upgrade handshake via query parameter.
        clean_token = str(auth_token).removeprefix("Bearer ").strip()
        user = await authenticate_websocket_token(clean_token)
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired access token.")
            return
        await websocket.accept()
    else:
        # Backward-compatible fallback for in-band message handshake
        await websocket.accept()
        try:
            raw_auth = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            auth_data = json.loads(raw_auth)
            if auth_data.get("type") != "auth" or not auth_data.get("token"):
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing auth handshake.")
                return

            msg_token = str(auth_data["token"]).removeprefix("Bearer ").strip()
            user = await authenticate_websocket_token(msg_token)
            if not user:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired access token.")
                return

        except (asyncio.TimeoutError, json.JSONDecodeError, WebSocketDisconnect):
            try:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Handshake timeout or invalid payload.")
            except Exception:
                pass
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

                    elif msg_type == "auth":
                        # Client sent auth frame after handshake auth; acknowledge or ignore safely
                        continue

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
