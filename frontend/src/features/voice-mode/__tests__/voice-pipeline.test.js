import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeWAV } from '../wav-encoder';
import { calculateRMS, VoiceActivityDetector } from '../vad';
import { PlaybackQueue } from '../playback-queue';

describe('Voice Audio Pipeline - wav-encoder', () => {
  it('encodes Float32Array into standard 44-byte RIFF/WAVE header and 16-bit PCM', () => {
    const samples = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
    const buffer = encodeWAV(samples, 16000);

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBe(44 + samples.length * 2);

    const view = new DataView(buffer);
    // Check RIFF
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    expect(riff).toBe('RIFF');

    // Check WAVE
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    expect(wave).toBe('WAVE');

    // Check fmt
    const fmt = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
    expect(fmt).toBe('fmt ');

    // Check AudioFormat = 1 (PCM), NumChannels = 1, SampleRate = 16000, BitsPerSample = 16
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);

    // Check data chunk
    const data = String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39));
    expect(data).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('clamps samples outside [-1.0, 1.0] without integer overflow', () => {
    const samples = new Float32Array([2.5, -3.0]);
    const buffer = encodeWAV(samples, 16000);
    const view = new DataView(buffer);

    // Max int16 is 32767, min int16 is -32768
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});

describe('Voice Audio Pipeline - vad (Voice Activity Detection)', () => {
  it('calculateRMS returns 0 for empty or silence, and accurate RMS for signals', () => {
    expect(calculateRMS(new Float32Array([]))).toBe(0);
    expect(calculateRMS(new Float32Array([0, 0, 0, 0]))).toBe(0);

    const constant = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(calculateRMS(constant)).toBeCloseTo(0.5, 4);

    const alternating = new Float32Array([1.0, -1.0]);
    expect(calculateRMS(alternating)).toBeCloseTo(1.0, 4);
  });

  it('detects speech start when sustained energy exceeds threshold', () => {
    const onSpeechStart = vi.fn();
    const vad = new VoiceActivityDetector({
      onSpeechStart,
      sampleRate: 16000,
      silenceThresholdMs: 1000,
      minUtteranceMs: 400
    });

    // 1600 samples at 16kHz = 100ms
    const speechChunk = new Float32Array(1600).fill(0.1);
    vad.processChunk(speechChunk, false);

    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    expect(vad.isSpeaking).toBe(true);
  });

  it('detects barge-in when user speaks loudly while assistant is speaking', () => {
    const onBargeIn = vi.fn();
    const vad = new VoiceActivityDetector({
      onBargeIn,
      sampleRate: 16000
    });

    // Feed 300ms of loud speech (4800 samples)
    const loudSpeech = new Float32Array(4800).fill(0.15);
    vad.processChunk(loudSpeech, true);

    expect(onBargeIn).toHaveBeenCalled();
  });

  it('resets cleanly when reset() is called', () => {
    const vad = new VoiceActivityDetector({ sampleRate: 16000 });
    const speechChunk = new Float32Array(1600).fill(0.1);
    vad.processChunk(speechChunk, false);
    expect(vad.isSpeaking).toBe(true);

    vad.reset();
    expect(vad.isSpeaking).toBe(false);
    expect(vad.collectedChunks.length).toBe(0);
  });

  it('defaults silenceThresholdMs to 800ms for low-latency turnaround', () => {
    const vad = new VoiceActivityDetector();
    expect(vad.silenceThresholdMs).toBe(800);
  });
});

describe('Voice Audio Pipeline - playback-queue', () => {
  let mockAudioContext;

  beforeEach(() => {
    mockAudioContext = {
      state: 'running',
      currentTime: 1.0,
      destination: {},
      resume: vi.fn().mockResolvedValue(),
      decodeAudioData: vi.fn().mockImplementation(async (buf) => ({
        duration: 1.5,
        length: 24000
      })),
      createBufferSource: vi.fn().mockImplementation(() => ({
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onended: null
      }))
    };
  });

  it('initializes with expected seq 1 and idle state', () => {
    const queue = new PlaybackQueue(mockAudioContext);
    expect(queue.nextExpectedSeq).toBe(1);
    expect(queue.isPlaying).toBe(false);
    expect(queue.pendingChunks.size).toBe(0);
  });

  it('enqueues and plays sequential chunks in strict order', async () => {
    const onPlaybackStart = vi.fn();
    const queue = new PlaybackQueue(mockAudioContext, { onPlaybackStart });

    // Enqueue seq 1
    const dummyBase64 = btoa('RIFF....WAVE');
    await queue.enqueueBase64WAV(1, dummyBase64, 'First sentence.');

    expect(mockAudioContext.decodeAudioData).toHaveBeenCalled();
    expect(mockAudioContext.createBufferSource).toHaveBeenCalledTimes(1);
    expect(queue.nextExpectedSeq).toBe(2);
    expect(queue.isPlaying).toBe(true);
    expect(onPlaybackStart).toHaveBeenCalledWith(1, 'First sentence.');
  });

  it('holds out-of-order chunks until earlier sequence is received', async () => {
    const queue = new PlaybackQueue(mockAudioContext);
    const dummyBase64 = btoa('RIFF....WAVE');

    // Enqueue seq 2 before seq 1
    await queue.enqueueBase64WAV(2, dummyBase64, 'Second sentence.');

    expect(queue.pendingChunks.has(2)).toBe(true);
    expect(mockAudioContext.createBufferSource).not.toHaveBeenCalled();

    // Now enqueue seq 1
    await queue.enqueueBase64WAV(1, dummyBase64, 'First sentence.');

    // Both should now be scheduled sequentially
    expect(mockAudioContext.createBufferSource).toHaveBeenCalledTimes(2);
    expect(queue.nextExpectedSeq).toBe(3);
    expect(queue.pendingChunks.size).toBe(0);
  });

  it('stopAndClear flushes active sources, cancels pending, and resets seq to 1', async () => {
    const onQueueEmpty = vi.fn();
    const queue = new PlaybackQueue(mockAudioContext, { onQueueEmpty });
    const dummyBase64 = btoa('RIFF....WAVE');

    await queue.enqueueBase64WAV(1, dummyBase64, 'First sentence.');
    expect(queue.isPlaying).toBe(true);

    queue.stopAndClear();
    expect(queue.isPlaying).toBe(false);
    expect(queue.nextExpectedSeq).toBe(1);
    expect(queue.activeSourceNodes.size).toBe(0);
    expect(queue.pendingChunks.size).toBe(0);
    expect(onQueueEmpty).toHaveBeenCalled();
  });
});
