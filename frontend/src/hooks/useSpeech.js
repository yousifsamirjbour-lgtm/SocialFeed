import { useState, useRef, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../config/api';

/**
 * Strips markdown syntax from text to produce clean, natural spoken speech.
 */
export function cleanMarkdownForSpeech(text) {
  if (!text) return '';
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, ' ')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Convert markdown links [text](url) to text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    // Remove headers (# Title)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove blockquotes (> quote)
    .replace(/(^|\s)>\s*/gm, '$1')
    .replace(/>/g, '')
    // Remove emphasis bold/italic (**text**, *text*, __text__, _text_)
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Remove strikethrough (~~text~~)
    .replace(/~~(.*?)~~/g, '$1')
    // Remove bullet points / list numbers
    .replace(/^\s*[\*\-\+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Collapse extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chunks text into slices strictly <= 190 characters, splitting cleanly on
 * sentence boundaries or punctuation.
 */
export function chunkTextForTTS(text, maxChars = 185) {
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
  return /[\u0600-\u06FF]/.test(text);
}

export function useSpeech(token) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const activeAudioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const stopRequestedRef = useRef(false);

  // Stop any active audio playback
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
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  // Browser speechSynthesis fallback
  const speakWithBrowser = useCallback((text, isArabic) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setIsSpeaking(false);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = isArabic ? 'ar-SA' : 'en-US';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      setIsSpeaking(false);
    }
  }, []);

  // Neural Groq Orpheus TTS with fallback
  const speak = useCallback(async (fullText) => {
    stopSpeaking();
    stopRequestedRef.current = false;

    if (!fullText) return;
    const isArabic = isArabicText(fullText);
    const chunks = chunkTextForTTS(fullText, 185);

    if (chunks.length === 0) return;

    setIsSpeaking(true);

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (stopRequestedRef.current) break;

        const chunk = chunks[i];
        const res = await fetch(`${API_BASE_URL}/audio/tts`, {
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

        if (!res.ok) {
          // If Groq fails (e.g. rate limit 429), fall back to browser speech synthesis
          speakWithBrowser(chunks.slice(i).join(' '), isArabic);
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
      // Fallback to browser speech synthesis
      speakWithBrowser(fullText, isArabic);
    } finally {
      if (!stopRequestedRef.current) {
        setIsSpeaking(false);
      }
    }
  }, [token, stopSpeaking, speakWithBrowser]);

  // Audio Recording (STT via Groq Whisper)
  const startRecording = useCallback(async () => {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    isRecording,
    recordingSeconds
  };
}
