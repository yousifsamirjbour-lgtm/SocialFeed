import os
import io
import re
import hashlib
import logging
from datetime import date
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, status, File, UploadFile, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
import groq

from backend.models.db import User
from backend.core.users import current_active_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audio", tags=["Audio"])

MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB
MAX_TTS_DAILY_REQUESTS = 150
MAX_TTS_CHARS = 190  # Strictly bounded to 190 to respect Groq's 200 character hard limit

# In-memory cache for generated TTS audio bytes (hash -> bytes)
_tts_cache: Dict[str, bytes] = {}

# In-memory daily usage tracking for zero-cost guardrails (user_id -> {"date": date, "count": int})
_tts_usage: Dict[str, Dict[str, Any]] = {}

def is_arabic_text(text: str) -> bool:
    """Checks if a string contains Arabic characters."""
    return bool(re.search(r"[\u0600-\u06FF]", text))

def get_groq_client() -> groq.Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GROQ_API_KEY is not configured on the server."
        )
    return groq.Groq(api_key=api_key)

class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TTS_CHARS)
    lang: str = Field("auto", pattern="^(auto|en|ar)$")
    voice: Optional[str] = None

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

@router.post("/tts")
async def synthesize_speech(
    request: TTSRequest,
    user: User = Depends(current_active_user)
):
    """
    Synthesizes neural speech using Groq's Orpheus models:
    - English: canopylabs/orpheus-v1-english (default voice: autumn)
    - Arabic: canopylabs/orpheus-arabic-saudi (default voice: fahad)
    Enforces a strict 190-character chunk limit and daily rate limits.
    Returns audio/wav bytes.
    """
    user_id = str(user.id)
    today = date.today()

    # 1. Enforce per-user daily rate limits
    usage = _tts_usage.get(user_id)
    if not usage or usage.get("date") != today:
        _tts_usage[user_id] = {"date": today, "count": 1}
    else:
        if usage["count"] >= MAX_TTS_DAILY_REQUESTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Daily neural TTS generation quota exceeded. Falling back to browser speech synthesis."
            )
        usage["count"] += 1

    # 2. Determine model and voice
    text_clean = request.text.strip()
    is_ar = (request.lang == "ar") or (request.lang == "auto" and is_arabic_text(text_clean))

    if is_ar:
        model = "canopylabs/orpheus-arabic-saudi"
        voice = request.voice or "fahad"
    else:
        model = "canopylabs/orpheus-v1-english"
        voice = request.voice or "autumn"

    # 3. Cache lookup by hash
    cache_key = hashlib.sha256(f"{model}:{voice}:{text_clean}".encode("utf-8")).hexdigest()
    if cache_key in _tts_cache:
        return Response(content=_tts_cache[cache_key], media_type="audio/wav")

    # 4. Generate speech from Groq
    client = get_groq_client()

    def _sync_tts() -> bytes:
        response = client.audio.speech.create(
            model=model,
            voice=voice,
            input=text_clean,
            response_format="wav"
        )
        if hasattr(response, "content"):
            return response.content
        if hasattr(response, "read"):
            return response.read()
        return bytes(response)

    try:
        audio_bytes = await run_in_threadpool(_sync_tts)
        # Store in cache (limit size to 500 entries)
        if len(_tts_cache) > 500:
            _tts_cache.pop(next(iter(_tts_cache)))
        _tts_cache[cache_key] = audio_bytes

        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={"Content-Disposition": "inline; filename=speech.wav"}
        )
    except Exception as e:
        logger.error(f"Groq TTS synthesis error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Neural TTS generation failed: {str(e)}"
        )
