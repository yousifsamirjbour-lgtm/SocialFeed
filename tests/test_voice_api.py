import json
import uuid
import pytest
from datetime import date
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.main import app
from backend.models.db import VoiceDailyQuota
from backend.core.users import get_jwt_strategy
from backend.services.voice.tts import TTSFallbackException

@pytest.fixture
def sync_client():
    return TestClient(app)

@pytest.fixture
async def valid_token(test_user):
    strategy = get_jwt_strategy()
    return await strategy.write_token(test_user)

def test_websocket_auth_handshake_success(sync_client, valid_token):
    with sync_client.websocket_connect("/api/voice/stream") as ws:
        ws.send_text(json.dumps({
            "type": "auth",
            "token": valid_token
        }))
        res_raw = ws.receive_text()
        data = json.loads(res_raw)
        assert data["type"] == "auth_ok"
        assert "session_id" in data
        assert data["seconds_left"] > 0
        assert data["turns_left"] > 0

def test_websocket_auth_invalid_token(sync_client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with sync_client.websocket_connect("/api/voice/stream") as ws:
            ws.send_text(json.dumps({
                "type": "auth",
                "token": "completely_invalid_jwt_token"
            }))
            ws.receive_text()
    assert exc.value.code == 1008

def test_websocket_auth_missing_type(sync_client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with sync_client.websocket_connect("/api/voice/stream") as ws:
            ws.send_text(json.dumps({
                "type": "not_auth",
                "token": "abc"
            }))
            ws.receive_text()
    assert exc.value.code == 1008

def test_websocket_ping_pong(sync_client, valid_token):
    with sync_client.websocket_connect("/api/voice/stream") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": valid_token}))
        json.loads(ws.receive_text()) # auth_ok

        ws.send_text(json.dumps({"type": "ping"}))
        pong = json.loads(ws.receive_text())
        assert pong["type"] == "pong"

def test_websocket_barge_in_interrupt(sync_client, valid_token):
    with sync_client.websocket_connect("/api/voice/stream") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": valid_token}))
        json.loads(ws.receive_text()) # auth_ok

        ws.send_text(json.dumps({"type": "interrupt", "turn_id": 42}))
        res = json.loads(ws.receive_text())
        assert res["type"] == "interrupted"
        assert res["turn_id"] == 42

def test_websocket_turn_flow_with_mocked_services(sync_client, valid_token, monkeypatch):
    # Mock STT
    async def mock_stt(wav_bytes):
        return {
            "text": "What is SocialFeed?",
            "language": "en",
            "duration_seconds": 10,
            "is_valid": True,
            "reason": "OK"
        }
    monkeypatch.setattr("backend.api.voice.transcribe_voice_utterance", mock_stt)

    # Mock LLM
    async def mock_llm_stream(history, user_query, language="en"):
        yield "SocialFeed is a modern social networking platform."
        yield "It features real-time voice and AI capabilities."
    monkeypatch.setattr("backend.api.voice.stream_voice_llm_chunks", mock_llm_stream)

    # Mock TTS
    async def mock_tts(text, language="en", voice=None):
        return b"RIFF....WAVEfmt ....data...."
    monkeypatch.setattr("backend.api.voice.synthesize_voice_chunk", mock_tts)

    with sync_client.websocket_connect("/api/voice/stream") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": valid_token}))
        auth_msg = json.loads(ws.receive_text())
        assert auth_msg["type"] == "auth_ok"

        # Send audio header + binary frame
        ws.send_text(json.dumps({
            "type": "user_audio_header",
            "turn_id": 1,
            "duration_ms": 1500
        }))
        fake_wav = b"RIFF" + b"\x00" * 8000
        ws.send_bytes(fake_wav)

        # 1. Turn start
        msg1 = json.loads(ws.receive_text())
        assert msg1["type"] == "turn_start"
        assert msg1["turn_id"] == 1

        # 2. Transcript
        msg2 = json.loads(ws.receive_text())
        assert msg2["type"] == "transcript"
        assert msg2["text"] == "What is SocialFeed?"

        # 3. Audio chunk 1
        msg3 = json.loads(ws.receive_text())
        assert msg3["type"] == "audio_chunk"
        assert msg3["seq"] == 1
        assert "SocialFeed" in msg3["text"]
        assert len(msg3["audio"]) > 0

        # 4. Audio chunk 2
        msg4 = json.loads(ws.receive_text())
        assert msg4["type"] == "audio_chunk"
        assert msg4["seq"] == 2

        # 5. Turn complete
        msg5 = json.loads(ws.receive_text())
        assert msg5["type"] == "turn_complete"
        assert "SocialFeed" in msg5["assistant_transcript"]

def test_websocket_silence_discarded(sync_client, valid_token, monkeypatch):
    async def mock_silence_stt(wav_bytes):
        return {
            "text": "",
            "language": "en",
            "duration_seconds": 0,
            "is_valid": False,
            "reason": "Filtered silence hallucination ('.')."
        }
    monkeypatch.setattr("backend.api.voice.transcribe_voice_utterance", mock_silence_stt)

    with sync_client.websocket_connect("/api/voice/stream") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": valid_token}))
        json.loads(ws.receive_text())

        ws.send_text(json.dumps({"type": "user_audio_header", "turn_id": 2}))
        ws.send_bytes(b"RIFF" + b"\x00" * 8000)

        msg1 = json.loads(ws.receive_text())
        assert msg1["type"] == "turn_start"

        msg2 = json.loads(ws.receive_text())
        assert msg2["type"] == "turn_discarded"
        assert "silence" in msg2["reason"].lower()

def test_websocket_tts_fallback_trigger(sync_client, valid_token, monkeypatch):
    async def mock_stt(wav_bytes):
        return {
            "text": "Hello assistant",
            "language": "en",
            "duration_seconds": 10,
            "is_valid": True,
            "reason": "OK"
        }
    monkeypatch.setattr("backend.api.voice.transcribe_voice_utterance", mock_stt)

    async def mock_llm_stream(history, user_query, language="en"):
        yield "Hello there! How can I help you today?"
    monkeypatch.setattr("backend.api.voice.stream_voice_llm_chunks", mock_llm_stream)

    async def mock_failing_tts(text, language="en", voice=None):
        raise TTSFallbackException("Orpheus 429 quota reached.")
    monkeypatch.setattr("backend.api.voice.synthesize_voice_chunk", mock_failing_tts)

    with sync_client.websocket_connect("/api/voice/stream") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": valid_token}))
        json.loads(ws.receive_text())

        ws.send_text(json.dumps({"type": "user_audio_header", "turn_id": 3}))
        ws.send_bytes(b"RIFF" + b"\x00" * 8000)

        json.loads(ws.receive_text()) # turn_start
        json.loads(ws.receive_text()) # transcript

        msg_fallback = json.loads(ws.receive_text())
        assert msg_fallback["type"] == "tts_fallback"
        assert "Hello there" in msg_fallback["text"]

@pytest.mark.asyncio
async def test_websocket_daily_quota_exceeded(db_session, test_user, sync_client, valid_token):
    # Pre-seed quota to 900 seconds
    today = date.today()
    q = VoiceDailyQuota(
        user_id=test_user.id,
        usage_date=today,
        seconds_used=900,
        turns_count=60
    )
    db_session.add(q)
    await db_session.commit()

    with pytest.raises(WebSocketDisconnect) as exc:
        with sync_client.websocket_connect("/api/voice/stream") as ws:
            ws.send_text(json.dumps({"type": "auth", "token": valid_token}))
            res = json.loads(ws.receive_text())
            assert res["type"] == "quota_exceeded"
            ws.receive_text()
    assert exc.value.code == 1008
