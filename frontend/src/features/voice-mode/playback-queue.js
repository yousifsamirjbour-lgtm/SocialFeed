/**
 * playback-queue.js
 * Gapless sequential audio player for Web Audio API.
 * Ensures strict sequential playback (seq: 1, 2, ...), seamless audio concatenation,
 * and instant flushing on barge-in / interruption.
 */

export class PlaybackQueue {
  constructor(audioContext, { onPlaybackStart, onPlaybackEnd, onQueueEmpty } = {}) {
    this.audioContext = audioContext;
    this.onPlaybackStart = onPlaybackStart;
    this.onPlaybackEnd = onPlaybackEnd;
    this.onQueueEmpty = onQueueEmpty;

    this.pendingChunks = new Map(); // seq -> { audioBuffer, text }
    this.nextExpectedSeq = 1;
    this.scheduledEndTime = 0;
    this.activeSourceNodes = new Set();
    this.isPlaying = false;
  }

  async enqueueBase64WAV(seq, base64Audio, text = '') {
    if (!base64Audio) return;

    try {
      // Ensure AudioContext is resumed before decodeAudioData
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }

      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // decodeAudioData requires a fresh copy of the buffer
      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer.slice(0));
      this.pendingChunks.set(seq, { audioBuffer, text });
      this.schedulePending();
    } catch (err) {
      console.error(`Failed to decode audio chunk seq ${seq}:`, err);
    }
  }

  schedulePending() {
    if (!this.audioContext || this.audioContext.state === 'closed') return;

    // Resume AudioContext if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    while (this.pendingChunks.has(this.nextExpectedSeq)) {
      const { audioBuffer, text } = this.pendingChunks.get(this.nextExpectedSeq);
      this.pendingChunks.delete(this.nextExpectedSeq);

      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(this.audioContext.destination);

      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(currentTime, this.scheduledEndTime);
      sourceNode.start(startTime);

      this.scheduledEndTime = startTime + audioBuffer.duration;
      this.activeSourceNodes.add(sourceNode);

      const currentSeq = this.nextExpectedSeq;
      this.nextExpectedSeq++;

      if (!this.isPlaying) {
        this.isPlaying = true;
        if (this.onPlaybackStart) this.onPlaybackStart(currentSeq, text);
      }

      sourceNode.onended = () => {
        this.activeSourceNodes.delete(sourceNode);
        if (this.onPlaybackEnd) this.onPlaybackEnd(currentSeq, text);

        if (this.activeSourceNodes.size === 0 && this.pendingChunks.size === 0) {
          this.isPlaying = false;
          this.scheduledEndTime = 0;
          if (this.onQueueEmpty) this.onQueueEmpty();
        }
      };
    }
  }

  stopAndClear() {
    // Immediately stop and disconnect all playing and scheduled nodes
    for (const node of this.activeSourceNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {
        // Ignored if node already stopped
      }
    }
    this.activeSourceNodes.clear();
    this.pendingChunks.clear();
    this.nextExpectedSeq = 1;
    this.scheduledEndTime = 0;
    this.isPlaying = false;

    if (this.onQueueEmpty) this.onQueueEmpty();
  }

  resetTurn() {
    this.stopAndClear();
  }
}
