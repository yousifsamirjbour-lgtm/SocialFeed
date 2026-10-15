import os
import re
import logging
from typing import AsyncGenerator, List, Dict, Any, Optional
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

# Strictly bounded well below 190 characters to guarantee Orpheus never exceeds 200 limit
MAX_CHUNK_CHARS = 135

SYSTEM_PROMPT = (
    "You are a friendly, natural, real-time voice assistant for SocialFeed. "
    "Guidelines:\n"
    "1. Speak directly and concisely in 1 to 3 natural conversational sentences.\n"
    "2. Never use markdown formatting (no bold, no italics, no bullet points, no numbered lists).\n"
    "3. Never use emojis, ASCII art, or URLs.\n"
    "4. Reply in the exact same language the user spoke (Arabic or English).\n"
    "5. Use plain spoken language that sounds smooth and engaging when read aloud."
)

def get_groq_client() -> groq.Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set.")
    return groq.Groq(api_key=api_key)

def split_text_into_chunks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> List[str]:
    """
    Splits a body of text into clean spoken chunks of at most max_chars on sentence
    or word boundaries.
    """
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return []

    # First split on standard sentence terminators (. ! ? ؟ \n)
    sentences = re.split(r"(?<=[.!?؟\n])\s+", clean)
    chunks = []

    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(s) <= max_chars:
            chunks.append(s)
        else:
            # Sub-split long sentences on punctuation (, ; : ، ؛) or words
            sub_parts = re.split(r"(?<=[,;:\،؛])\s+", s)
            current = ""
            for p in sub_parts:
                p = p.strip()
                if not p:
                    continue
                if len(current) + len(p) + 1 <= max_chars:
                    current = f"{current} {p}".strip()
                else:
                    if current:
                        chunks.append(current)
                    if len(p) <= max_chars:
                        current = p
                    else:
                        # Hard split by words
                        words = p.split()
                        w_curr = ""
                        for w in words:
                            if len(w_curr) + len(w) + 1 <= max_chars:
                                w_curr = f"{w_curr} {w}".strip()
                            else:
                                if w_curr:
                                    chunks.append(w_curr)
                                w_curr = w
                        current = w_curr
            if current:
                chunks.append(current)

    return chunks

@traceable(name="voice_llm_stream", run_type="llm")
async def stream_voice_llm_chunks(
    history: List[Dict[str, str]],
    user_query: str,
    language: str = "en"
) -> AsyncGenerator[str, None]:
    """
    Streams conversational LLM response from Groq, yielding cleanly bounded sentences
    as soon as they are formed.
    """
    client = get_groq_client()
    model = os.getenv("VOICE_LLM_MODEL", "openai/gpt-oss-20b")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    # Add in-memory history (last 6 messages)
    for m in history[-6:]:
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": user_query})

    def _sync_create_stream(target_model: str):
        return client.chat.completions.create(
            model=target_model,
            messages=messages,
            temperature=0.6,
            max_tokens=300,
            stream=True
        )

    try:
        try:
            stream = await run_in_threadpool(_sync_create_stream, model)
        except Exception as e:
            logger.warning(f"Voice LLM model {model} failed, falling back to qwen/qwen3.8-27b: {e}")
            stream = await run_in_threadpool(_sync_create_stream, "qwen/qwen3.8-27b")

        buffer = ""
        # Sentence termination pattern: (. ! ? ؟ \n)
        boundary_pattern = re.compile(r"([.!?؟\n]+)")

        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            content = getattr(delta, "content", "") or ""
            if not content:
                continue

            buffer += content

            # Check for sentence boundaries
            parts = boundary_pattern.split(buffer)
            # If we have at least one delimiter (i.e. parts has len >= 3: [prefix, delimiter, remainder])
            if len(parts) >= 3:
                # Combine completed sentence: parts[0] + parts[1]
                sentence = (parts[0] + parts[1]).strip()
                buffer = "".join(parts[2:])

                if sentence:
                    # Enforce strict character chunking well below 190
                    for sub_chunk in split_text_into_chunks(sentence, MAX_CHUNK_CHARS):
                        if sub_chunk:
                            yield sub_chunk
            elif len(buffer) >= 110:
                # If buffer is getting long without sentence boundary, split on punctuation/words
                chunks = split_text_into_chunks(buffer, MAX_CHUNK_CHARS)
                if len(chunks) > 1:
                    for c in chunks[:-1]:
                        yield c
                    buffer = chunks[-1]

        # Flush remaining buffer at end of stream
        if buffer.strip():
            for sub_chunk in split_text_into_chunks(buffer, MAX_CHUNK_CHARS):
                if sub_chunk:
                    yield sub_chunk

    except Exception as e:
        logger.error(f"Voice LLM streaming error: {e}")
        raise
