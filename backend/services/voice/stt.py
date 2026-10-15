import os
import io
import re
import logging
from typing import Dict, Any, Optional
import groq
from fastapi.concurrency import run_in_threadpool

try:
    from langsmith import traceable
except ImportError:
    def traceable(*args, **kwargs):
        def decorator(f):
            return f
        return decorator

logger = logging.getLogger(__name__)

# Prime Whisper with cross-lingual context to guarantee Arabic & English speech comprehension
WHISPER_INITIAL_PROMPT = (
    "SocialFeed voice assistant. مرحبا بكم وأهلاً وسهلاً. "
    "Conversational bilingual English and Arabic speech transcription."
)

# Known silence/noise hallucinations produced by Whisper models
SILENCE_HALLUCINATION_PATTERNS = [
    r"^[\s\.\,\!\?؟\-_]*$",
    r"^(thank you|thanks for watching|subscribe to the channel|please subscribe|bye|goodbye|you|thank you very much)[\.\!\?؟\s]*$",
    r"^(اشترك في القناة|اشتركوا في القناة|شكرا للمشاهدة|شكراً للمشاهدة|شكرا لك|شكراً لك|مع السلامة|إلى اللقاء|سبحان الله وبحمده|لا إله إلا الله|ترجمة وتعديل|يتبع)[\.\!\?؟\s]*$"
]

DISCARD_PHRASES = {
    "thank you.", "thank you", "thank you very much", "thank you very much.",
    "thanks for watching.", "thanks for watching",
    "subscribe to the channel", "subscribe to the channel.",
    "please subscribe", "please subscribe.",
    "bye", "goodbye", "you",
    "اشترك في القناة", "اشترك في القناة.", "اشتركوا في القناة",
    "شكرا للمشاهدة", "شكرا للمشاهدة.", "شكراً للمشاهدة", "شكراً للمشاهدة.",
    "شكرا لك", "شكراً لك", "شكرا", "شكراً",
    "مع السلامة", "إلى اللقاء",
    "سبحان الله وبحمده", "لا إله إلا الله",
    "."
}

def is_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", text))

def get_groq_client() -> groq.Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set.")
    return groq.Groq(api_key=api_key)

@traceable(name="voice_whisper_stt", run_type="tool")
async def transcribe_voice_utterance(
    wav_bytes: bytes,
    filename: str = "utterance.wav"
) -> Dict[str, Any]:
    """
    Transcribes a 16kHz mono WAV audio utterance using Groq Whisper.
    Applies strict VAD validation, hallucination filtering, duration accounting,
    and bilingual priming for English and Arabic.
    """
    if len(wav_bytes) < 44:
        return {
            "text": "",
            "language": "en",
            "duration_seconds": 0,
            "is_valid": False,
            "reason": "Audio data empty or header corrupted."
        }

    # Strict VAD: 500ms of 16kHz 16-bit mono PCM is 16,000 bytes. With 44-byte WAV header: 16,044 bytes
    if len(wav_bytes) < 16000:
        return {
            "text": "",
            "language": "en",
            "duration_seconds": 0,
            "is_valid": False,
            "reason": "Audio duration too short (under 500ms threshold)."
        }

    client = get_groq_client()

    def _sync_transcribe(model_name: str):
        return client.audio.transcriptions.create(
            file=(filename, wav_bytes),
            model=model_name,
            prompt=WHISPER_INITIAL_PROMPT,
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

        # 1. Check no_speech_prob and avg_logprob across segments
        segments = getattr(res, "segments", []) or []
        for seg in segments:
            no_speech = seg.get("no_speech_prob") if isinstance(seg, dict) else getattr(seg, "no_speech_prob", None)
            avg_logprob = seg.get("avg_logprob") if isinstance(seg, dict) else getattr(seg, "avg_logprob", None)

            if no_speech is not None and float(no_speech) > 0.4:
                logger.info(f"Discarding Whisper hallucination: high no_speech_prob ({float(no_speech):.2f} > 0.4)")
                return {
                    "text": "",
                    "language": detected_language,
                    "duration_seconds": billed_duration,
                    "is_valid": False,
                    "reason": f"High no_speech_prob ({float(no_speech):.2f} > 0.4)."
                }

            if avg_logprob is not None and float(avg_logprob) < -1.0:
                logger.info(f"Discarding Whisper hallucination: low avg_logprob ({float(avg_logprob):.2f} < -1.0)")
                return {
                    "text": "",
                    "language": detected_language,
                    "duration_seconds": billed_duration,
                    "is_valid": False,
                    "reason": f"Low avg_logprob ({float(avg_logprob):.2f} < -1.0)."
                }

        # 2. Check exact discard phrases
        if clean_text.lower() in DISCARD_PHRASES or clean_text in DISCARD_PHRASES:
            logger.info(f"Discarding Whisper hallucination: matched discard phrase '{clean_text}'")
            return {
                "text": "",
                "language": detected_language,
                "duration_seconds": billed_duration,
                "is_valid": False,
                "reason": f"Filtered silence hallucination ('{clean_text}')."
            }

        # 3. Check silence hallucination regex patterns
        for pattern in SILENCE_HALLUCINATION_PATTERNS:
            if re.match(pattern, clean_text, re.IGNORECASE):
                logger.info(f"Discarding Whisper hallucination: matched pattern '{pattern}' on '{clean_text}'")
                return {
                    "text": "",
                    "language": detected_language,
                    "duration_seconds": billed_duration,
                    "is_valid": False,
                    "reason": f"Filtered silence hallucination ('{clean_text}')."
                }

        # Ensure language is cleanly normalized to Arabic whenever Arabic script is present
        is_ar_speech = is_arabic(clean_text) or str(detected_language).lower().startswith("ar")
        final_lang = "ar" if is_ar_speech else str(detected_language).lower()

        return {
            "text": clean_text,
            "language": final_lang,
            "duration_seconds": billed_duration,
            "is_valid": True,
            "reason": "Speech detected successfully."
        }

    except Exception as e:
        logger.error(f"Whisper transcription error: {e}")
        raise
