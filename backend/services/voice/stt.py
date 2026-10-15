import os
import io
import re
import logging
from typing import Dict, Any, Optional
import groq
from fastapi.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

# Known silence/noise hallucinations produced by Whisper models
SILENCE_HALLUCINATION_PATTERNS = [
    r"^[\s\.\,\!\?؟\-_]*$",
    r"^(thank you|thanks for watching|bye|goodbye|you)[\.\!\?؟\s]*$"
]

def get_groq_client() -> groq.Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set.")
    return groq.Groq(api_key=api_key)

async def transcribe_voice_utterance(
    wav_bytes: bytes,
    filename: str = "utterance.wav"
) -> Dict[str, Any]:
    """
    Transcribes a 16kHz mono WAV audio utterance using Groq Whisper.
    Applies strict VAD validation, hallucination filtering, and duration accounting.
    """
    if len(wav_bytes) < 44:
        return {
            "text": "",
            "language": "en",
            "duration_seconds": 0,
            "is_valid": False,
            "reason": "Audio data empty or header corrupted."
        }

    # ~400ms of 16kHz 16-bit mono is ~12,800 bytes. With 44-byte WAV header, ~8,000 bytes is ~250ms
    if len(wav_bytes) < 8000:
        return {
            "text": "",
            "language": "en",
            "duration_seconds": 0,
            "is_valid": False,
            "reason": "Audio duration too short (below minimum threshold)."
        }

    client = get_groq_client()

    def _sync_transcribe(model_name: str):
        return client.audio.transcriptions.create(
            file=(filename, wav_bytes),
            model=model_name,
            response_format="verbose_json",
            temperature=0.0
        )

    try:
        try:
            res = await run_in_threadpool(_sync_transcribe, "whisper-large-v3-turbo")
        except Exception as e:
            logger.warning(f"Whisper turbo failed, falling back to whisper-large-v3: {e}")
            res = await run_in_threadpool(_sync_transcribe, "whisper-large-v3")

        raw_text = getattr(res, "text", "") or ""
        clean_text = raw_text.strip()
        detected_language = getattr(res, "language", "en") or "en"
        raw_duration = getattr(res, "duration", 0) or 0
        billed_duration = max(10, int(round(raw_duration)))

        # 1. Check no_speech_prob on segments
        segments = getattr(res, "segments", []) or []
        if segments:
            no_speech = segments[0].get("no_speech_prob") if isinstance(segments[0], dict) else getattr(segments[0], "no_speech_prob", None)
            if no_speech is not None and float(no_speech) > 0.65:
                return {
                    "text": "",
                    "language": detected_language,
                    "duration_seconds": billed_duration,
                    "is_valid": False,
                    "reason": f"High no_speech_prob ({no_speech:.2f})."
                }

        # 2. Check silence hallucination patterns
        for pattern in SILENCE_HALLUCINATION_PATTERNS:
            if re.match(pattern, clean_text, re.IGNORECASE):
                return {
                    "text": "",
                    "language": detected_language,
                    "duration_seconds": billed_duration,
                    "is_valid": False,
                    "reason": f"Filtered silence hallucination ('{clean_text}')."
                }

        return {
            "text": clean_text,
            "language": str(detected_language).lower(),
            "duration_seconds": billed_duration,
            "is_valid": True,
            "reason": "Speech detected successfully."
        }

    except Exception as e:
        logger.error(f"Whisper transcription error: {e}")
        raise
