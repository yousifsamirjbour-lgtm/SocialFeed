import './VoiceOrb.css';

/**
 * VoiceOrb Component
 * Sleek 4-state reactive audio orb:
 * - 'idle' | 'listening': Gentle ambient breathing pulse
 * - 'user_speaking': Expands dynamically with microphone amplitude
 * - 'thinking': Orbiting shimmer particles and rotating cosmic aura
 * - 'assistant_speaking': Fluid organic ripples synchronized with speech playback
 */
export default function VoiceOrb({ voiceState = 'idle', amplitude = 0 }) {
  // Normalize scale based on voiceState and amplitude
  const scale = voiceState === 'user_speaking'
    ? 1.0 + Math.min(0.5, amplitude * 0.8)
    : 1.0;

  return (
    <div className={`voice-orb-container state-${voiceState}`}>
      {/* Outer ambient glow ring */}
      <div 
        className="voice-orb-halo" 
        style={{ transform: `scale(${scale * 1.25})` }} 
      />

      {/* Mid acoustic ripple ring */}
      <div 
        className="voice-orb-ripple" 
        style={{ transform: `scale(${scale * 1.12})` }} 
      />

      {/* Inner core orb */}
      <div 
        className="voice-orb-core" 
        style={{ transform: `scale(${scale})` }}
      >
        <div className="voice-orb-sheen" />
        <div className="voice-orb-swirl" />
      </div>

      {/* Orbiting particles for thinking state */}
      {voiceState === 'thinking' && (
        <div className="voice-orb-spinner">
          <div className="orbit-dot dot-1" />
          <div className="orbit-dot dot-2" />
          <div className="orbit-dot dot-3" />
        </div>
      )}
    </div>
  );
}
