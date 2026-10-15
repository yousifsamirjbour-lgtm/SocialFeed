/**
 * vad.js
 * Browser-side Voice Activity Detection (VAD) with adaptive noise calibration,
 * silence thresholding (1.0-1.2s), and barge-in interruption detection.
 */

export function calculateRMS(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

export class VoiceActivityDetector {
  constructor({
    onSpeechStart,
    onSpeechEnd,
    onBargeIn,
    onUtteranceComplete,
    sampleRate = 16000,
    silenceThresholdMs = 800,  // 800ms silence marks utterance completion
    minUtteranceMs = 500       // Hardened VAD: filter out noise/clicks shorter than 500ms
  } = {}) {
    this.sampleRate = sampleRate;
    this.silenceThresholdMs = silenceThresholdMs;
    this.minUtteranceMs = minUtteranceMs;

    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.onBargeIn = onBargeIn;
    this.onUtteranceComplete = onUtteranceComplete;

    // Thresholds
    this.baseThreshold = 0.018;
    this.bargeInThreshold = 0.040; // Higher threshold during assistant speech
    this.noiseFloor = 0.005;

    // State
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.consecutiveSpeechMs = 0;
    this.collectedChunks = [];
    this.preRollSamples = null;
  }

  setPreRoll(samples) {
    this.preRollSamples = samples;
  }

  processChunk(samples, isAssistantSpeaking = false) {
    const rms = calculateRMS(samples);
    const now = Date.now();
    const chunkMs = (samples.length / this.sampleRate) * 1000;

    // Adaptive noise floor tracking when silent
    if (rms < this.baseThreshold) {
      this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
    }

    const threshold = isAssistantSpeaking ? this.bargeInThreshold : Math.max(this.baseThreshold, this.noiseFloor * 2.8);

    if (rms > threshold) {
      this.lastSpeechTime = now;
      this.consecutiveSpeechMs += chunkMs;

      if (!this.isSpeaking) {
        // Require at least 80ms of speech before triggering speech start
        if (this.consecutiveSpeechMs >= 80) {
          this.isSpeaking = true;
          this.speechStartTime = now;
          if (this.onSpeechStart) this.onSpeechStart();

          // If assistant is currently speaking, require 250ms of sustained speech for barge-in
          if (isAssistantSpeaking && this.consecutiveSpeechMs >= 250) {
            if (this.onBargeIn) this.onBargeIn();
          }
        }
      } else if (isAssistantSpeaking && this.consecutiveSpeechMs >= 250) {
        if (this.onBargeIn) this.onBargeIn();
      }

      if (this.isSpeaking) {
        this.collectedChunks.push(samples);
      }
    } else {
      this.consecutiveSpeechMs = 0;

      if (this.isSpeaking) {
        this.collectedChunks.push(samples);
        const silenceDuration = now - this.lastSpeechTime;

        if (silenceDuration >= this.silenceThresholdMs) {
          this.finishUtterance();
        }
      }
    }

    return { rms, isSpeaking: this.isSpeaking };
  }

  finishUtterance() {
    if (!this.isSpeaking) return;

    this.isSpeaking = false;
    if (this.onSpeechEnd) this.onSpeechEnd();

    // Calculate total duration
    let totalSamplesCount = 0;
    for (const c of this.collectedChunks) {
      totalSamplesCount += c.length;
    }
    const durationMs = (totalSamplesCount / this.sampleRate) * 1000;

    const preRollLen = this.preRollSamples ? this.preRollSamples.length : 0;
    const totalUtteranceMs = ((preRollLen + totalSamplesCount) / this.sampleRate) * 1000;

    // Strict VAD: Filter utterances below minimum 500ms duration threshold
    if (durationMs >= this.minUtteranceMs && totalUtteranceMs >= 500) {
      // Assemble final array with pre-roll prepended
      const finalBuffer = new Float32Array(preRollLen + totalSamplesCount);

      if (this.preRollSamples) {
        finalBuffer.set(this.preRollSamples, 0);
      }

      let offset = preRollLen;
      for (const c of this.collectedChunks) {
        finalBuffer.set(c, offset);
        offset += c.length;
      }

      if (this.onUtteranceComplete) {
        this.onUtteranceComplete(finalBuffer, totalUtteranceMs);
      }
    }

    this.collectedChunks = [];
    this.preRollSamples = null;
    this.consecutiveSpeechMs = 0;
    this.lastSpeechTime = 0;
    this.speechStartTime = 0;
  }

  reset() {
    this.isSpeaking = false;
    this.consecutiveSpeechMs = 0;
    this.collectedChunks = [];
    this.preRollSamples = null;
    this.lastSpeechTime = 0;
    this.speechStartTime = 0;
  }
}
