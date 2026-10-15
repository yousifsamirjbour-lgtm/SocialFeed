/**
 * VoiceAudioProcessor (AudioWorklet)
 * Runs on the Web Audio rendering thread to:
 * 1. Maintain a circular rolling pre-roll buffer (~300ms at 16kHz = 4800 samples).
 * 2. Downsample microphone input from audioContext.sampleRate (typically 44.1k or 48k) to 16kHz mono.
 * 3. Emit 16kHz mono PCM chunks to the main thread.
 */

class VoiceAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    // Input sample rate provided by AudioWorkletGlobalScope
    this.sourceSampleRate = sampleRate;
    this.resampleRatio = this.sourceSampleRate / this.targetSampleRate;

    // Rolling circular pre-roll buffer (300ms at 16kHz = 4800 samples)
    this.preRollSize = Math.floor(this.targetSampleRate * 0.3);
    this.preRollBuffer = new Float32Array(this.preRollSize);
    this.preRollIndex = 0;

    // Resampling state
    this.sampleFraction = 0.0;
    this.isRecording = false;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.command === 'start_recording') {
        this.isRecording = true;
        // Emit captured pre-roll buffer
        const orderedPreRoll = new Float32Array(this.preRollSize);
        for (let i = 0; i < this.preRollSize; i++) {
          orderedPreRoll[i] = this.preRollBuffer[(this.preRollIndex + i) % this.preRollSize];
        }
        this.port.postMessage({
          type: 'preroll_data',
          samples: orderedPreRoll
        });
      } else if (data && data.command === 'stop_recording') {
        this.isRecording = false;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const inputChannel = input[0];
    const inputLength = inputChannel.length;

    // Resample input to 16kHz linear interpolation
    const resampled = [];
    while (this.sampleFraction < inputLength) {
      const index0 = Math.floor(this.sampleFraction);
      const index1 = Math.min(index0 + 1, inputLength - 1);
      const weight = this.sampleFraction - index0;
      const sample = inputChannel[index0] * (1 - weight) + inputChannel[index1] * weight;
      resampled.push(sample);
      this.sampleFraction += this.resampleRatio;
    }
    this.sampleFraction -= inputLength;

    if (resampled.length > 0) {
      const pcm16k = new Float32Array(resampled);

      // Always update rolling circular pre-roll buffer
      for (let i = 0; i < pcm16k.length; i++) {
        this.preRollBuffer[this.preRollIndex] = pcm16k[i];
        this.preRollIndex = (this.preRollIndex + 1) % this.preRollSize;
      }

      // If active recording, send samples to main thread for VAD & aggregation
      this.port.postMessage({
        type: 'audio_chunk',
        samples: pcm16k,
        isRecording: this.isRecording
      });
    }

    return true;
  }
}

registerProcessor('voice-audio-processor', VoiceAudioProcessor);
