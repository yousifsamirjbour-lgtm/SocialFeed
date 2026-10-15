import { useState, useEffect, useRef, useCallback } from 'react';
import { encodeWAV } from './wav-encoder';
import { VoiceActivityDetector } from './vad';
import { PlaybackQueue } from './playback-queue';

export function useVoiceConversation(token, { enabled = true } = {}) {
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // 'connecting' | 'connected' | 'disconnected' | 'error'
  const [voiceState, setVoiceState] = useState('idle'); // 'idle' | 'listening' | 'user_speaking' | 'thinking' | 'assistant_speaking'
  const [errorMessage, setErrorMessage] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(900);
  const [turnsLeft, setTurnsLeft] = useState(60);
  const [isMuted, setIsMuted] = useState(false);
  const [micAmplitude, setMicAmplitude] = useState(0);

  const [transcripts, setTranscripts] = useState({
    currentUserText: '',
    currentAssistantText: '',
    history: []
  });

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const micStreamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const analyserNodeRef = useRef(null);
  const vadRef = useRef(null);
  const playbackQueueRef = useRef(null);
  const turnIdRef = useRef(1);
  const isMutedRef = useRef(false);

  // Keep isMutedRef in sync
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Construct WebSocket URL
  const getWebSocketURL = useCallback(() => {
    const isHttps = window.location.protocol === 'https:';
    const wsProto = isHttps ? 'wss:' : 'ws:';
    const host = window.location.host;
    // Handle Vite dev server proxying or direct port 8000
    if (window.location.port === '5173') {
      return `${wsProto}//${window.location.hostname}:8000/api/voice/stream`;
    }
    return `${wsProto}//${host}/api/voice/stream`;
  }, []);

  // Barge-In Interruption handler
  const handleInterrupt = useCallback(() => {
    if (playbackQueueRef.current) {
      playbackQueueRef.current.stopAndClear();
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'interrupt',
        turn_id: turnIdRef.current
      }));
    }

    setVoiceState('listening');
  }, []);

  // Initialize Web Audio and AudioWorklet
  const initAudioPipeline = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextClass();
    audioContextRef.current = ctx;

    // Analyzer for UI visualizer
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserNodeRef.current = analyser;

    // Playback queue
    playbackQueueRef.current = new PlaybackQueue(ctx, {
      onPlaybackStart: () => setVoiceState('assistant_speaking'),
      onQueueEmpty: () => {
        setVoiceState('listening');
      }
    });

    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    micStreamRef.current = stream;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    // VAD Instance
    const vad = new VoiceActivityDetector({
      onSpeechStart: () => {
        if (!isMutedRef.current) {
          setVoiceState('user_speaking');
        }
      },
      onBargeIn: () => {
        if (!isMutedRef.current) {
          handleInterrupt();
          setVoiceState('user_speaking');
        }
      },
      onUtteranceComplete: (samples, durationMs) => {
        if (isMutedRef.current) return;

        setVoiceState('thinking');
        const currentTurn = turnIdRef.current;
        turnIdRef.current += 1;

        // Encode to 16kHz mono WAV
        const wavBuffer = encodeWAV(samples, 16000);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          // Send JSON header first
          wsRef.current.send(JSON.stringify({
            type: 'user_audio_header',
            turn_id: currentTurn,
            duration_ms: Math.round(durationMs)
          }));
          // Send raw binary frame
          wsRef.current.send(wavBuffer);
        }
      }
    });
    vadRef.current = vad;

    // Load AudioWorklet
    try {
      await ctx.audioWorklet.addModule('/voice-audio-processor.js');
      const workletNode = new AudioWorkletNode(ctx, 'voice-audio-processor');
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event) => {
        const data = event.data;
        if (!data || isMutedRef.current) return;

        if (data.type === 'preroll_data') {
          vad.setPreRoll(data.samples);
        } else if (data.type === 'audio_chunk') {
          const isAssistantSpeaking = playbackQueueRef.current?.isPlaying || false;
          const { rms } = vad.processChunk(data.samples, isAssistantSpeaking);
          setMicAmplitude(Math.min(1.0, rms * 15.0));
        }
      };

      source.connect(workletNode);
      workletNode.port.postMessage({ command: 'start_recording' });
    } catch (workletErr) {
      console.warn('AudioWorklet unavailable, falling back to script processor:', workletErr);
    }
  }, [handleInterrupt]);

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    if (!token || !enabled) return;

    setConnectionStatus('connecting');
    setErrorMessage('');

    const wsUrl = getWebSocketURL();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Step 1: Send JWT auth handshake
      ws.send(JSON.stringify({
        type: 'auth',
        token
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'auth_ok') {
          setConnectionStatus('connected');
          setVoiceState('listening');
          if (msg.seconds_left !== undefined) setSecondsLeft(msg.seconds_left);
          if (msg.turns_left !== undefined) setTurnsLeft(msg.turns_left);
        } else if (msg.type === 'turn_start') {
          setVoiceState('thinking');
        } else if (msg.type === 'transcript') {
          if (msg.role === 'user') {
            setTranscripts((prev) => ({
              ...prev,
              currentUserText: msg.text,
              currentAssistantText: ''
            }));
          }
          if (msg.seconds_left !== undefined) setSecondsLeft(msg.seconds_left);
          if (msg.turns_left !== undefined) setTurnsLeft(msg.turns_left);
        } else if (msg.type === 'audio_chunk') {
          if (msg.turn_id === turnIdRef.current - 1 || msg.turn_id === turnIdRef.current) {
            setTranscripts((prev) => ({
              ...prev,
              currentAssistantText: `${prev.currentAssistantText} ${msg.text}`.trim()
            }));
            playbackQueueRef.current?.enqueueBase64WAV(msg.seq, msg.audio, msg.text);
          }
        } else if (msg.type === 'tts_fallback') {
          // Client speech synthesis fallback
          if (window.speechSynthesis && msg.text) {
            const utterance = new SpeechSynthesisUtterance(msg.text);
            utterance.onstart = () => setVoiceState('assistant_speaking');
            utterance.onend = () => setVoiceState('listening');
            window.speechSynthesis.speak(utterance);
          }
        } else if (msg.type === 'turn_complete') {
          setTranscripts((prev) => ({
            currentUserText: '',
            currentAssistantText: '',
            history: [
              ...prev.history,
              { role: 'user', text: prev.currentUserText },
              { role: 'assistant', text: msg.assistant_transcript || prev.currentAssistantText }
            ]
          }));
          if (msg.seconds_left !== undefined) setSecondsLeft(msg.seconds_left);
          if (msg.turns_left !== undefined) setTurnsLeft(msg.turns_left);
          setVoiceState('listening');
        } else if (msg.type === 'turn_discarded') {
          setVoiceState('listening');
        } else if (msg.type === 'quota_exceeded') {
          setErrorMessage(msg.message || 'Daily voice quota reached.');
          setConnectionStatus('error');
          setVoiceState('idle');
        } else if (msg.type === 'error') {
          setErrorMessage(msg.message || 'Voice communication issue occurred.');
        }
      } catch (err) {
        console.error('Error parsing voice WebSocket message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('Voice WebSocket connection error:', err);
      setConnectionStatus('error');
      setErrorMessage('Could not connect to voice service.');
    };

    ws.onclose = (event) => {
      setConnectionStatus('disconnected');
      setVoiceState('idle');
      if (event.code === 1008) {
        setErrorMessage(event.reason || 'Authentication failed or quota exceeded.');
      }
    };
  }, [token, enabled, getWebSocketURL]);

  // Teardown
  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (playbackQueueRef.current) {
      playbackQueueRef.current.stopAndClear();
      playbackQueueRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setVoiceState('idle');
    setConnectionStatus('disconnected');
  }, []);

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  return {
    connectionStatus,
    voiceState,
    errorMessage,
    secondsLeft,
    turnsLeft,
    isMuted,
    micAmplitude,
    transcripts,
    initAudioPipeline,
    connectWebSocket,
    toggleMute,
    interrupt: handleInterrupt,
    cleanup
  };
}
