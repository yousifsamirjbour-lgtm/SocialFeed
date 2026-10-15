import io
import pytest
from httpx import AsyncClient
from unittest.mock import MagicMock, patch

@pytest.mark.asyncio
async def test_stt_unauthorized(client: AsyncClient):
    files = {"file": ("recording.webm", io.BytesIO(b"dummy audio bytes"), "audio/webm")}
    resp = await client.post("/api/audio/stt", files=files)
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_stt_unsupported_mimetype(client: AsyncClient, auth_headers: dict):
    files = {"file": ("image.png", io.BytesIO(b"not audio"), "image/png")}
    resp = await client.post("/api/audio/stt", files=files, headers=auth_headers)
    assert resp.status_code == 415

@pytest.mark.asyncio
async def test_stt_empty_file(client: AsyncClient, auth_headers: dict):
    files = {"file": ("empty.webm", io.BytesIO(b""), "audio/webm")}
    resp = await client.post("/api/audio/stt", files=files, headers=auth_headers)
    assert resp.status_code == 400

@pytest.mark.asyncio
async def test_stt_success_with_mocked_groq(client: AsyncClient, auth_headers: dict):
    mock_transcription = MagicMock()
    mock_transcription.text = "Hello, this is a test audio transcription."

    with patch("groq.Groq") as mock_groq_class:
        mock_instance = MagicMock()
        mock_groq_class.return_value = mock_instance
        mock_instance.audio.transcriptions.create.return_value = mock_transcription

        files = {"file": ("voice.webm", io.BytesIO(b"audio binary data"), "audio/webm")}
        resp = await client.post("/api/audio/stt", files=files, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["transcript"] == "Hello, this is a test audio transcription."
        assert data["filename"] == "voice.webm"

@pytest.mark.asyncio
async def test_tts_unauthorized(client: AsyncClient):
    resp = await client.post("/api/audio/tts", json={"text": "Hello world", "lang": "en"})
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_tts_exceeds_190_chars(client: AsyncClient, auth_headers: dict):
    long_text = "A" * 191
    resp = await client.post("/api/audio/tts", json={"text": long_text, "lang": "en"}, headers=auth_headers)
    assert resp.status_code == 422  # Bounded by Pydantic max_length=190

@pytest.mark.asyncio
async def test_tts_success_and_caching(client: AsyncClient, auth_headers: dict):
    fake_wav = b"RIFF....WAVEfmt ...."
    mock_response = MagicMock()
    mock_response.content = fake_wav

    with patch("groq.Groq") as mock_groq_class:
        mock_instance = MagicMock()
        mock_groq_class.return_value = mock_instance
        mock_instance.audio.speech.create.return_value = mock_response

        # 1. First call
        resp1 = await client.post("/api/audio/tts", json={"text": "This is a neural speech test.", "lang": "en"}, headers=auth_headers)
        assert resp1.status_code == 200
        assert resp1.headers["content-type"] == "audio/wav"
        assert resp1.content == fake_wav
        assert mock_instance.audio.speech.create.call_count == 1

        # 2. Second call with identical text should hit cache without calling Groq API again
        resp2 = await client.post("/api/audio/tts", json={"text": "This is a neural speech test.", "lang": "en"}, headers=auth_headers)
        assert resp2.status_code == 200
        assert resp2.content == fake_wav
        assert mock_instance.audio.speech.create.call_count == 1  # Still 1, verified cache hit!

@pytest.mark.asyncio
async def test_tts_arabic_routing(client: AsyncClient, auth_headers: dict):
    fake_wav = b"RIFF....ARABICWAVE...."
    mock_response = MagicMock()
    mock_response.content = fake_wav

    with patch("groq.Groq") as mock_groq_class:
        mock_instance = MagicMock()
        mock_groq_class.return_value = mock_instance
        mock_instance.audio.speech.create.return_value = mock_response

        resp = await client.post("/api/audio/tts", json={"text": "مرحباً بكم في منصتنا", "lang": "auto"}, headers=auth_headers)
        assert resp.status_code == 200
        # Check model called
        kwargs = mock_instance.audio.speech.create.call_args.kwargs
        assert kwargs["model"] == "canopylabs/orpheus-arabic-saudi"
        assert kwargs["voice"] == "fahad"

