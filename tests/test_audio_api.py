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
