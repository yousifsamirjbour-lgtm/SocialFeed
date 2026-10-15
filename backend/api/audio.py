import os
import io
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, status, File, UploadFile
from fastapi.concurrency import run_in_threadpool
import groq

from backend.models.db import User
from backend.core.users import current_active_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audio", tags=["Audio"])

MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB

def get_groq_client() -> groq.Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GROQ_API_KEY is not configured on the server."
        )
    return groq.Groq(api_key=api_key)

@router.post("/stt")
async def transcribe_audio(
    file: UploadFile = File(...),
    user: User = Depends(current_active_user)
):
    """
    Transcribes uploaded voice recordings to text using Groq's whisper-large-v3-turbo.
    Supports English, Arabic, and multilingual audio with high precision.
    """
    content_type = (file.content_type or "audio/webm").split(";")[0].strip().lower()
    if not content_type.startswith("audio/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{content_type}'. Must be an audio file."
        )

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded audio file is empty."
        )

    if len(file_bytes) > MAX_AUDIO_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Audio file exceeds {MAX_AUDIO_SIZE_BYTES // (1024 * 1024)}MB maximum limit."
        )

    client = get_groq_client()
    filename = file.filename or "recording.webm"

    def _sync_transcribe():
        return client.audio.transcriptions.create(
            file=(filename, file_bytes),
            model="whisper-large-v3-turbo",
            response_format="json"
        )

    try:
        transcription = await run_in_threadpool(_sync_transcribe)
        text = getattr(transcription, "text", str(transcription)).strip()
        return {
            "transcript": text,
            "filename": filename
        }
    except Exception as e:
        logger.error(f"Whisper transcription error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to transcribe audio: {str(e)}"
        )
