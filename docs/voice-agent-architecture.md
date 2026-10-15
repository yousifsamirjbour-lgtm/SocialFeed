# Joupro Realtime Voice Agent ("Voice Mode")

A low-latency, real-time bidirectional voice assistant resembling ChatGPT / Gemini Voice with natural turn-taking, barge-in interruption, and streaming audio synthesis.

---

## 1. Zero-Cost Guarantee ($0.00)
- **Speech-to-Text (STT)**: Groq Whisper (`whisper-large-v3-turbo` with fallback to `whisper-large-v3`) via free-tier `GROQ_API_KEY`.
- **Text-to-Speech (TTS)**: Groq Orpheus TTS (`canopylabs/orpheus-v1-english` / `canopylabs/orpheus-arabic-saudi`) via free-tier `GROQ_API_KEY`.
- **Language Model (LLM)**: Groq Chat Completion (`openai/gpt-oss-20b` / `llama-3.3-70b-versatile`) via free-tier `GROQ_API_KEY`.
- **No external paid services, torch/ffmpeg binaries, or GPU instances required.**

---

## 2. Complete Architectural Isolation from Hybrid RAG
1. **Zero Shared State**: Voice Mode operates exclusively in-memory for the duration of the WebSocket session (keeping the last 6 conversational turns). It does not read, write, or touch document embeddings, vector chunks, `document_chunks` table, or hybrid chat sessions.
2. **Dedicated Quota Table**: Daily usage is tracked in an isolated PostgreSQL table (`voice_daily_quotas`) enforcing a 10-minute (600s) daily limit per user, using a 10-second minimum billing accounting floor to preserve free quota.
3. **Dedicated Failure Domain**: Any disruption, rate-limit (HTTP 429), or error in Voice Mode has zero impact on the hybrid RAG chatbot, document attachments, or post feeds, and vice versa.

---

## 3. Realtime Audio Pipeline Architecture

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser as AudioWorklet + VAD (Client)
    participant WS as FastAPI WebSocket (/api/voice/stream)
    participant Whisper as Groq Whisper STT
    participant LLM as Groq Streaming LLM
    participant Orpheus as Groq Orpheus TTS
    participant AudioOut as Web Audio Playback Queue

    Note over Browser,WS: 1. Handshake & Auth
    Browser->>WS: {"type": "auth", "token": "<JWT>"} (within 5.0s)
    WS-->>Browser: {"type": "auth_ok", "session_id": "...", "remaining_seconds": 600}

    Note over Browser: 2. Voice Activity Detection (VAD)
    User->>Browser: Speaks ("Hello, what's new?")
    Browser->>Browser: 16kHz PCM + ~300ms pre-roll + 1.1s silence detection
    Browser->>WS: Binary 16-bit Mono WAV (turn_id: 1)

    Note over WS,Whisper: 3. STT & Silence Filtering
    WS->>Whisper: Transcribe WAV (verbose_json, temperature 0)
    Whisper-->>WS: {"text": "Hello, what's new?", "no_speech_prob": 0.02, "language": "en"}
    WS-->>Browser: {"type": "transcript", "role": "user", "text": "...", "turn_id": 1}

    Note over WS,LLM: 4. Streaming Sentence Splitting (<=190 chars)
    WS->>LLM: Stream completion (System prompt: plain spoken, max 4 sentences)
    LLM-->>WS: Stream tokens -> Split on [.!?\n] (<=190 chars on word boundaries)

    Note over WS,Orpheus: 5. TTS Dispatch & Sequential Playback
    WS->>Orpheus: Synthesize chunk (autumn / fahad voice)
    Orpheus-->>WS: WAV Audio Bytes
    WS-->>Browser: {"type": "audio_chunk", "turn_id": 1, "seq": 1, "audio": "<base64>"}
    Browser->>AudioOut: Gapless Web Audio decode & schedule

    Note over User,AudioOut: 6. Barge-In Interruption
    User->>Browser: Speaks while assistant is speaking (RMS > 0.040 for 250ms)
    Browser->>AudioOut: stopAndClear() (instantly mute assistant)
    Browser->>WS: {"type": "interrupt", "turn_id": 1}
    WS->>WS: Cancel pending LLM/TTS background tasks
    Browser->>WS: Binary WAV (turn_id: 2)
```

---

## 4. WebSocket Message Protocol (`/api/voice/stream`)

### Client -> Server:
| Message | Description |
|---|---|
| `{"type": "auth", "token": "<JWT>"}` | Mandatory initial authentication frame (within 5.0s) |
| Binary 16-bit Mono WAV Buffer | Encoded speech utterance from client-side VAD with header prefix `turn_id` |
| `{"type": "interrupt", "turn_id": N}` | Client barge-in: cancel current response generation immediately |
| `{"type": "ping"}` | Client keepalive ping |

### Server -> Client:
| Message | Description |
|---|---|
| `{"type": "auth_ok", "session_id": "...", "remaining_seconds": N}` | Handshake successful |
| `{"type": "transcript", "role": "user", "text": "...", "turn_id": N}` | Speech-to-text result |
| `{"type": "audio_chunk", "turn_id": N, "seq": S, "text": "...", "audio": "<base64>"}` | Synthesized sentence audio chunk for sequential playback |
| `{"type": "turn_end", "turn_id": N}` | Assistant turn completed |
| `{"type": "interrupted", "turn_id": N}` | Acknowledges server cancelled turn generation |
| `{"type": "quota_exceeded", "message": "..."}` | Daily 10-minute quota reached |
| `{"type": "tts_fallback", "text": "..."}` | Graceful fallback if TTS rate limits occur |
| `{"type": "pong"}` | Server keepalive pong |

---

## 5. Production Nginx Configuration
See `docs/nginx-voice-wss.conf` for reverse proxy directives:
- WebSocket upgrade (`Upgrade: $http_upgrade`, `Connection: $connection_upgrade`).
- Buffer disabling (`proxy_buffering off;`).
- Extended timeout (`proxy_read_timeout 86400s;`).
