import { useState, useRef, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../config/api';

/**
 * Strips markdown syntax, code blocks, raw URLs, and citation brackets
 * to produce clean, natural spoken speech.
 */
export function cleanMarkdownForSpeech(text) {
  if (!text) return '';

  let clean = text;

  // 1. Remove multi-line code blocks
  clean = clean.replace(/```[\s\S]*?```/g, ' ');

  // 2. Remove inline code backticks while preserving inner text
  clean = clean.replace(/`([^`]+)`/g, '$1');

  // 3. Remove document citation tags: [file.pdf, p. 1], [doc.txt, chunk 0], 【doc.txt, p. 1】, (p. 1)
  clean = clean.replace(/[\[【\(][^\]】\)]*?\.(?:pdf|docx|txt|md|csv)[^\]】\)]*?[\]】\)]/gi, ' ');
  clean = clean.replace(/[\[【\(]\s*(?:Doc|Document|Page|p\.|chunk)\s*\d+[^\]】\)]*?[\]】\)]/gi, ' ');

  // 4. Convert markdown links [Text](url) to "Text" and remove raw URLs
  clean = clean.replace(/\[([^\]]+)\]\((?:https?:\/\/[^\)]+|[^\)]+)\)/g, '$1');
  clean = clean.replace(/https?:\/\/\S+/gi, ' ');

  // 5. Handle Markdown Tables:
  // Strip separator lines |---|---|
  clean = clean.replace(/^\s*\|[\s\-:|]+\|\s*$/gm, '');
  // Convert table content rows | col1 | col2 | into natural sentence text
  clean = clean.replace(/^\s*\|(.+)\|\s*$/gm, (match, rowContent) => {
    const cells = rowContent.split('|').map(c => c.trim()).filter(Boolean);
    return cells.join('. ') + '.';
  });

  // 6. Remove markdown headers (# Title)
  clean = clean.replace(/^#{1,6}\s+/gm, '');

  // 7. Remove blockquotes (> quote)
  clean = clean.replace(/(^|\s)>\s*/gm, '$1');
  clean = clean.replace(/>/g, '');

  // 8. Remove emphasis bold/italic (**text**, *text*, __text__, _text_)
  clean = clean.replace(/(\*\*|__)(.*?)\1/g, '$2');
  clean = clean.replace(/(\*|_)(.*?)\1/g, '$2');

  // 9. Remove strikethrough (~~text~~)
  clean = clean.replace(/~~(.*?)~~/g, '$1');

  // 10. Remove bullet points and list numbers at start of lines
  clean = clean.replace(/^\s*[\*\-\+]\s+/gm, '');
  clean = clean.replace(/^\s*\d+[\.\)]\s+/gm, '');

  // 11. Remove emojis and common UI symbols
  clean = clean.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

  // 12. Collapse extra punctuation and whitespace
  clean = clean.replace(/[\t ]+/g, ' ');
  clean = clean.replace(/\n\s*\n+/g, '. ');
  clean = clean.replace(/\n+/g, ' ');
  // Collapse duplicate sentence punctuation
  clean = clean.replace(/([.!?؟])\s*([.!?؟])+/g, '$1 ');
  // Ensure space after sentence terminator, but not inside decimal numbers (like 98.4%)
  clean = clean.replace(/([a-zA-Z\u0600-\u06FF\)])([.!?؟])\s*/g, '$1$2 ');

  return clean.trim();
}

/**
 * Chunks text into slices strictly <= maxChars (default 175), splitting cleanly on
 * sentence boundaries or clause punctuation to prevent payload limits and browser truncation.
 */
export function chunkTextForTTS(text, maxChars = 175) {
  if (!text) return [];
  const clean = cleanMarkdownForSpeech(text);
  if (!clean) return [];

  // Split on sentence terminators (. ! ? \n and Arabic ؟ .)
  const sentencePattern = /([^.!?؟\n]+[.!?؟\n]+)/g;
  const rawSentences = clean.match(sentencePattern) || [clean];

  const chunks = [];
  let currentChunk = '';

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (trimmed.length > maxChars) {
      // Sentence is longer than maxChars: split by clauses or words
      const subParts = trimmed.split(/([,;،؛\s]+)/);
      for (const part of subParts) {
        if (!part) continue;
        if ((currentChunk + part).length <= maxChars) {
          currentChunk += part;
        } else {
          if (currentChunk.trim()) chunks.push(currentChunk.trim());
          currentChunk = part.length <= maxChars ? part : part.slice(0, maxChars);
        }
      }
    } else {
      if ((currentChunk + ' ' + trimmed).trim().length <= maxChars) {
        currentChunk = (currentChunk ? currentChunk + ' ' : '') + trimmed;
      } else {
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        currentChunk = trimmed;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 0 && c.length <= 190);
}

export function isArabicText(text) {
  return /[\u0600-\u06FF]/.test(text || '');
}

/**
 * Helper to pick the best matching browser voice for the detected language.
 */
function pickBestVoice(voices, isArabic) {
  if (!voices || voices.length === 0) return null;

  if (isArabic) {
    // 1. Look for ar-SA, ar-EG, or any ar-* voice
    const arVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('ar'));
    if (arVoice) return arVoice;
    // 2. Look for Arabic in voice name
    const arNamed = voices.find(v => /arabic|maged|tarik|laila|salma/i.test(v.name));
    if (arNamed) return arNamed;
  } else {
    // 1. Look for high-quality English voice (en-US, en-GB)
    const enHigh = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en') && /natural|google|premium|samantha|jenny/i.test(v.name));
    if (enHigh) return enHigh;
    const enVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'));
    if (enVoice) return enVoice;
  }

  return voices[0] || null;
}

export function useSpeech(token) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const activeAudioRef = useRef(null);
  const activeUtteranceRef = useRef(null);
  const speechKeepAliveRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const stopRequestedRef = useRef(false);

  // Stop any active audio playback (both neural audio and browser synthesis)
  const stopSpeaking = useCallback(() => {
    stopRequestedRef.current = true;
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      } catch (e) {
        // ignore
      }
      activeAudioRef.current = null;
    }
    if (speechKeepAliveRef.current) {
      clearInterval(speechKeepAliveRef.current);
      speechKeepAliveRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        // ignore
      }
    }
    activeUtteranceRef.current = null;
    setIsSpeaking(false);
  }, []);

  // Sequential Queued Browser Speech Synthesis
  const speakWithBrowserQueue = useCallback((chunks, isArabic) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || !chunks || chunks.length === 0) {
      setIsSpeaking(false);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      stopRequestedRef.current = false;
      setIsSpeaking(true);

      const voices = window.speechSynthesis.getVoices();
      const chosenVoice = pickBestVoice(voices, isArabic);

      let chunkIdx = 0;

      // Keepalive interval for Chromium pause bug (pauses after 14-15s)
      if (speechKeepAliveRef.current) clearInterval(speechKeepAliveRef.current);
      speechKeepAliveRef.current = setInterval(() => {
        if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }, 10000);

      const playNextChunk = () => {
        if (stopRequestedRef.current || chunkIdx >= chunks.length) {
          if (speechKeepAliveRef.current) clearInterval(speechKeepAliveRef.current);
          activeUtteranceRef.current = null;
          setIsSpeaking(false);
          return;
        }

        const chunkText = chunks[chunkIdx++];
        const utterance = new SpeechSynthesisUtterance(chunkText);
        activeUtteranceRef.current = utterance;

        if (chosenVoice) {
          utterance.voice = chosenVoice;
          utterance.lang = chosenVoice.lang;
        } else {
          utterance.lang = isArabic ? 'ar-SA' : 'en-US';
        }

        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        utterance.onend = () => {
          if (!stopRequestedRef.current) {
            playNextChunk();
          }
        };

        utterance.onerror = (e) => {
          if (e.error !== 'interrupted' && e.error !== 'canceled' && !stopRequestedRef.current) {
            playNextChunk();
          } else {
            if (speechKeepAliveRef.current) clearInterval(speechKeepAliveRef.current);
            setIsSpeaking(false);
          }
        };

        window.speechSynthesis.speak(utterance);
      };

      playNextChunk();
    } catch (e) {
      console.warn('Browser speech synthesis error:', e);
      setIsSpeaking(false);
    }
  }, []);

  // Neural Groq Orpheus TTS with seamless browser fallback
  const speak = useCallback(async (fullText) => {
    stopSpeaking();
    stopRequestedRef.current = false;

    if (!fullText) return;
    const isArabic = isArabicText(fullText);
    const chunks = chunkTextForTTS(fullText, 175);

    if (chunks.length === 0) return;

    setIsSpeaking(true);

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (stopRequestedRef.current) break;

        const chunk = chunks[i];
        let res;
        try {
          res = await fetch(`${API_BASE_URL}/audio/tts`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              text: chunk,
              lang: isArabic ? 'ar' : 'en'
            })
          });
        } catch (fetchErr) {
          // Network failure: fallback remaining chunks to browser queue
          speakWithBrowserQueue(chunks.slice(i), isArabic);
          return;
        }

        if (!res.ok) {
          // If Groq rate limited (429) or error: fallback remaining chunks to browser queue
          speakWithBrowserQueue(chunks.slice(i), isArabic);
          return;
        }

        const blob = await res.blob();
        if (stopRequestedRef.current) break;

        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        activeAudioRef.current = audio;

        await new Promise((resolve) => {
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          audio.play().catch(() => resolve());
        });

        if (stopRequestedRef.current) break;
      }
    } catch (err) {
      speakWithBrowserQueue(chunks, isArabic);
    } finally {
      if (!stopRequestedRef.current && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
        setIsSpeaking(false);
      }
    }
  }, [token, stopSpeaking, speakWithBrowserQueue]);

  // Audio Recording (STT via Groq Whisper with hardware constraints)
  const startRecording = useCallback(async () => {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      throw new Error(`Microphone access error: ${err.message || 'Permission denied'}`);
    }
  }, [isRecording]);

  // Discards recording without transcribing
  const cancelRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        if (mediaRecorderRef.current.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
        }
      } catch (e) {
        // ignore
      }
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingSeconds(0);
  }, []);

  // Stops recording and transcribes via Whisper STT
  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || !isRecording) return '';

    return new Promise((resolve, reject) => {
      const mediaRecorder = mediaRecorderRef.current;

      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        setRecordingSeconds(0);

        try {
          // Stop media tracks to turn off recording indicator
          mediaRecorder.stream.getTracks().forEach((track) => track.stop());

          const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
          if (audioBlob.size === 0) {
            resolve('');
            return;
          }

          const formData = new FormData();
          formData.append('file', audioBlob, 'recording.webm');

          const response = await fetch(`${API_BASE_URL}/audio/stt`, {
            method: 'POST',
            headers: {
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: formData
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || 'Voice transcription failed.');
          }

          const data = await response.json();
          resolve(data.transcript || '');
        } catch (err) {
          reject(err);
        }
      };

      mediaRecorder.stop();
    });
  }, [isRecording, token]);

  useEffect(() => {
    return () => {
      stopSpeaking();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          // ignore
        }
      }
    };
  }, [stopSpeaking]);

  return {
    speak,
    stopSpeaking,
    isSpeaking,
    startRecording,
    stopRecording,
    cancelRecording,
    isRecording,
    recordingSeconds
  };
}
