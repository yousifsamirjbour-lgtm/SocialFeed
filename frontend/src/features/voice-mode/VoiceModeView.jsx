import { useState, useEffect } from 'react';
import { 
  X, 
  Mic, 
  MicOff, 
  Square, 
  PhoneOff, 
  Clock, 
  Subtitles, 
  AlertCircle 
} from 'lucide-react';
import VoiceOrb from './VoiceOrb';
import { useVoiceConversation } from './useVoiceConversation';
import './VoiceModeView.css';

export default function VoiceModeView({ isOpen, onClose }) {
  const token = localStorage.getItem('token') || '';
  const [showSubtitles, setShowSubtitles] = useState(true);

  const {
    connectionStatus,
    voiceState,
    errorMessage,
    secondsLeft,
    isMuted,
    micAmplitude,
    transcripts,
    initAudioPipeline,
    connectWebSocket,
    toggleMute,
    interrupt,
    cleanup
  } = useVoiceConversation(token, { enabled: isOpen });

  // On open, initialize audio pipeline and connect WebSocket
  useEffect(() => {
    if (isOpen) {
      initAudioPipeline()
        .then(() => connectWebSocket())
        .catch((err) => {
          console.error('Failed to initialize audio pipeline:', err);
        });
    } else {
      cleanup();
    }
    return () => {
      cleanup();
    };
  }, [isOpen, initAudioPipeline, connectWebSocket, cleanup]);

  if (!isOpen) return null;

  // Format seconds left to "MM:SS" or minutes
  const formatTimeLeft = (sec) => {
    const mins = Math.floor(sec / 60);
    const remainder = sec % 60;
    return `${mins}m ${remainder.toString().padStart(2, '0')}s left`;
  };

  // Determine current active subtitle text
  const activeSubtitle = voiceState === 'assistant_speaking' || voiceState === 'thinking'
    ? (transcripts.currentAssistantText || transcripts.currentUserText)
    : (transcripts.currentUserText || transcripts.currentAssistantText);

  const isArabic = Boolean(activeSubtitle && /[\u0600-\u06FF]/.test(activeSubtitle));

  return (
    <div className="voice-mode-overlay" role="dialog" aria-modal="true" aria-label="Real-time Voice Mode">
      {/* Top Header */}
      <header className="voice-mode-header">
        <div className="voice-mode-brand">
          <div className="voice-mode-status-dot" data-status={connectionStatus} />
          <span className="voice-mode-title">SocialFeed Voice</span>
          <span className="voice-mode-state-pill">{voiceState.replace('_', ' ')}</span>
        </div>

        <div className="voice-mode-header-actions">
          {/* Quota Indicator */}
          <div className="voice-quota-badge" title="Daily voice time remaining">
            <Clock size={14} />
            <span>{formatTimeLeft(secondsLeft)}</span>
          </div>

          {/* Subtitles Toggle */}
          <button 
            className={`voice-header-btn ${showSubtitles ? 'active' : ''}`}
            onClick={() => setShowSubtitles((prev) => !prev)}
            title="Toggle live subtitles"
            aria-label="Toggle live subtitles"
          >
            <Subtitles size={18} />
          </button>

          {/* Close / Exit */}
          <button 
            className="voice-header-btn close-btn" 
            onClick={onClose}
            title="Exit Voice Mode"
            aria-label="Exit Voice Mode"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Main Center Stage */}
      <main className="voice-mode-main">
        <div className="voice-orb-wrapper">
          <VoiceOrb voiceState={voiceState} amplitude={micAmplitude} />
        </div>

        {/* State Label */}
        <div className="voice-status-text">
          {voiceState === 'listening' && (
            <p>Listening... Speak naturally in English or Arabic</p>
          )}
          {voiceState === 'user_speaking' && (
            <p className="active-glow">Hearing you...</p>
          )}
          {voiceState === 'thinking' && (
            <p className="thinking-text">Thinking...</p>
          )}
          {voiceState === 'assistant_speaking' && (
            <p className="active-glow">Speaking...</p>
          )}
          {voiceState === 'idle' && (
            <p>Ready to converse</p>
          )}
        </div>

        {/* Error notification */}
        {errorMessage && (
          <div className="voice-error-banner" role="alert">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Live Subtitles Overlay */}
        {showSubtitles && activeSubtitle && (
          <div className={`voice-subtitles-card ${isArabic ? 'rtl' : 'ltr'}`}>
            <p>{activeSubtitle}</p>
          </div>
        )}
      </main>

      {/* Bottom Floating Controls */}
      <footer className="voice-mode-footer">
        <div className="voice-controls-bar">
          {/* Mute Button */}
          <button 
            className={`voice-control-btn ${isMuted ? 'muted' : ''}`}
            onClick={toggleMute}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>

          {/* Interrupt / Stop Button */}
          <button 
            className="voice-control-btn interrupt-btn"
            onClick={interrupt}
            disabled={voiceState !== 'assistant_speaking' && voiceState !== 'thinking'}
            title="Interrupt and speak"
            aria-label="Interrupt and speak"
          >
            <Square size={20} />
          </button>

          {/* End Voice Call */}
          <button 
            className="voice-control-btn hangup-btn"
            onClick={onClose}
            title="End voice session"
            aria-label="End voice session"
          >
            <PhoneOff size={22} />
          </button>
        </div>
      </footer>
    </div>
  );
}
