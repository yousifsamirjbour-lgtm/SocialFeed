import os
import re
import asyncio
import hashlib
import logging
from typing import Optional, Dict
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

# In-memory LRU cache for synthesized audio chunks
_voice_tts_cache: Dict[str, bytes] = {}
MAX_CACHE_ENTRIES = 500

class TTSFallbackException(Exception):
    """Raised when Groq Orpheus quota or API limit requires client-side TTS fallback."""
    pass

# Pinned Groq Orpheus personas for 100% voice consistency across all chunks and turns
PINNED_VOICE_EN = "autumn"
PINNED_VOICE_AR = "fahad"

PINNED_CONFIGS = {
    "en": {"model": "canopylabs/orpheus-v1-english", "voice": PINNED_VOICE_EN},
    "ar": {"model": "canopylabs/orpheus-arabic-saudi", "voice": PINNED_VOICE_AR},
}

def is_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", text))

def get_groq_client() -> groq.Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set.")
    return groq.Groq(api_key=api_key)

@traceable(name="voice_orpheus_tts", run_type="tool")
async def synthesize_voice_chunk(
    text: str,
    language: str = "en",
    voice: Optional[str] = None
) -> bytes:
    """
    Synthesizes a short text chunk (<= 140 characters) using Groq Orpheus neural TTS.
    Returns audio/wav bytes with pinned voice persona consistency.
    """
    clean_text = text.strip()
    if not clean_text:
        return b""

    # Defensive character clamp strictly below Orpheus limits
    if len(clean_text) > 150:
        truncated = clean_text[:140].rsplit(' ', 1)[0].strip()
        clean_text = truncated if truncated else clean_text[:140]

    # Enforce static pinned voice per language to prevent persona shifting mid-turn
    is_ar = (language.startswith("ar")) or is_arabic(clean_text)
    config = PINNED_CONFIGS["ar"] if is_ar else PINNED_CONFIGS["en"]
    model = config["model"]
    chosen_voice = voice or config["voice"]

    # Cache lookup
    cache_key = hashlib.sha256(f"{model}:{chosen_voice}:{clean_text}".encode("utf-8")).hexdigest()
    if cache_key in _voice_tts_cache:
        return _voice_tts_cache[cache_key]

    client = get_groq_client()

    def _sync_create_speech() -> bytes:
        response = client.audio.speech.create(
            model=model,
            voice=chosen_voice,
            input=clean_text,
            response_format="wav"
        )
        if hasattr(response, "read"):
            return response.read()
        if hasattr(response, "content"):
            return response.content
        return bytes(response)

    # Attempt synthesis with 1-shot retry on 429
    max_attempts = 2
    for attempt in range(max_attempts):
        try:
            audio_bytes = await run_in_threadpool(_sync_create_speech)
            # Store in cache
            if len(_voice_tts_cache) >= MAX_CACHE_ENTRIES:
                _voice_tts_cache.pop(next(iter(_voice_tts_cache)))
            _voice_tts_cache[cache_key] = audio_bytes
            return audio_bytes

        except groq.RateLimitError as e:
            logger.warning(f"Orpheus TTS 429 RateLimit on attempt {attempt + 1}: {e}")
            if attempt < max_attempts - 1:
                # Brief backoff before 1 retry
                await asyncio.sleep(1.2)
                continue
            raise TTSFallbackException(f"Orpheus rate limit reached: {e}")

        except Exception as e:
            logger.error(f"Orpheus TTS error on '{clean_text[:40]}' (len={len(clean_text)}): {e}")
            if attempt < max_attempts - 1:
                await asyncio.sleep(0.8)
                continue
            raise TTSFallbackException(str(e))

    raise TTSFallbackException("Exhausted synthesis attempts.")
