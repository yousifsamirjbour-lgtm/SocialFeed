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

def test_websocket_consecutive_multi_turn_flow(sync_client, valid_token, monkeypatch):
    """Verifies that consecutive voice turns (Turn 1 -> Turn 2 -> Turn 3) execute cleanly on one WebSocket."""
    turn_counter = 0

    async def mock_stt(wav_bytes):
        nonlocal turn_counter
        turn_counter += 1
        return {
            "text": f"Question number {turn_counter}",
            "language": "en",
            "duration_seconds": 10,
            "is_valid": True,
            "reason": "OK"
        }
    monkeypatch.setattr("backend.api.voice.transcribe_voice_utterance", mock_stt)

    async def mock_llm_stream(history, user_query, language="en"):
        yield f"Answer for {user_query}."
    monkeypatch.setattr("backend.api.voice.stream_voice_llm_chunks", mock_llm_stream)

    async def mock_tts(text, language="en", voice=None):
        return b"RIFF....WAVE"
    monkeypatch.setattr("backend.api.voice.synthesize_voice_chunk", mock_tts)

    with sync_client.websocket_connect("/api/voice/stream") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": valid_token}))
        assert json.loads(ws.receive_text())["type"] == "auth_ok"

        # Execute 3 consecutive turns
        for turn in [1, 2, 3]:
            # Send header + audio
            ws.send_text(json.dumps({
                "type": "user_audio_header",
                "turn_id": turn,
                "duration_ms": 1200
            }))
            ws.send_bytes(b"RIFF" + b"\x00" * 8000)

            # 1. Turn start
            m_start = json.loads(ws.receive_text())
            assert m_start["type"] == "turn_start"
            assert m_start["turn_id"] == turn

            # 2. Transcript
            m_trans = json.loads(ws.receive_text())
            assert m_trans["type"] == "transcript"
            assert m_trans["turn_id"] == turn
            assert f"Question number {turn}" in m_trans["text"]

            # 3. Audio chunk
            m_chunk = json.loads(ws.receive_text())
            assert m_chunk["type"] == "audio_chunk"
            assert m_chunk["turn_id"] == turn
            assert m_chunk["seq"] == 1

            # 4. Turn complete
            m_comp = json.loads(ws.receive_text())
            assert m_comp["type"] == "turn_complete"
            assert m_comp["turn_id"] == turn

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

@pytest.mark.asyncio
async def test_whisper_hallucination_and_logprob_filtering(monkeypatch):
    from backend.services.voice.stt import transcribe_voice_utterance

    class MockSegment:
        def __init__(self, no_speech_prob, avg_logprob):
            self.no_speech_prob = no_speech_prob
            self.avg_logprob = avg_logprob

    class MockTranscriptionResponse:
        def __init__(self, text, segments):
            self.text = text
            self.language = "en"
            self.duration = 2.0
            self.segments = segments

    # 1. Test high no_speech_prob (> 0.4)
    def mock_high_no_speech(*args, **kwargs):
        return MockTranscriptionResponse("Some text", [MockSegment(0.45, -0.2)])

    monkeypatch.setattr("backend.services.voice.stt.get_groq_client", lambda: type("C", (), {
        "audio": type("A", (), {
            "transcriptions": type("T", (), {"create": mock_high_no_speech})()
        })()
    })())
    res = await transcribe_voice_utterance(b"RIFF" + b"\x00" * 8000)
    assert not res["is_valid"]
    assert "no_speech_prob" in res["reason"]

    # 2. Test low avg_logprob (< -1.0)
    def mock_low_logprob(*args, **kwargs):
        return MockTranscriptionResponse("Mumbled text", [MockSegment(0.1, -1.25)])

    monkeypatch.setattr("backend.services.voice.stt.get_groq_client", lambda: type("C", (), {
        "audio": type("A", (), {
            "transcriptions": type("T", (), {"create": mock_low_logprob})()
        })()
    })())
    res = await transcribe_voice_utterance(b"RIFF" + b"\x00" * 8000)
    assert not res["is_valid"]
    assert "avg_logprob" in res["reason"]

    # 3. Test discard phrases (e.g. 'اشترك في القناة', 'Thank you.', 'Thanks for watching.')
    for phrase in ["Thank you.", "Thanks for watching.", "Subscribe to the channel", "اشترك في القناة", "شكرا للمشاهدة", "."]:
        def mock_phrase(*args, **kwargs):
            return MockTranscriptionResponse(phrase, [MockSegment(0.05, -0.1)])

        monkeypatch.setattr("backend.services.voice.stt.get_groq_client", lambda: type("C", (), {
            "audio": type("A", (), {
                "transcriptions": type("T", (), {"create": mock_phrase})()
            })()
        })())
        res = await transcribe_voice_utterance(b"RIFF" + b"\x00" * 8000)
        assert not res["is_valid"], f"Expected '{phrase}' to be discarded"
        assert "hallucination" in res["reason"]

def test_chunk_length_and_sentence_splitting():
    from backend.services.voice.llm import split_text_into_chunks, MAX_CHUNK_CHARS

    assert MAX_CHUNK_CHARS <= 140

    long_text = (
        "Artificial intelligence and neural audio models are transforming real-time "
        "spoken interfaces across the world, creating low latency natural voice interactions "
        "that empower users to communicate naturally without keyboard or mouse input."
    )
    chunks = split_text_into_chunks(long_text, MAX_CHUNK_CHARS)
    assert len(chunks) > 1
    for c in chunks:
        assert len(c) <= MAX_CHUNK_CHARS
        assert len(c.strip()) > 0
