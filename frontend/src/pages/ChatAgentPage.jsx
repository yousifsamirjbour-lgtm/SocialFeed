import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Sparkles, 
  Send, 
  Paperclip, 
  Mic, 
  Square, 
  Volume2, 
  RotateCcw, 
  FileText, 
  Trash2, 
  CheckCircle2, 
  ExternalLink, 
  AlertCircle,
  FileCheck,
  Globe,
  Layers,
  ArrowLeft,
  Check,
  X,
  Headphones
} from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { useSpeech, isArabicText } from '../hooks/useSpeech';
import VoiceModeView from '../features/voice-mode/VoiceModeView';
import './ChatAgentPage.css';

export default function ChatAgentPage({ navigateToFeed }) {
  const token = localStorage.getItem('token') || '';
  const [chatSessionId, setChatSessionId] = useState(() => {
    return localStorage.getItem('chatSessionId') || crypto.randomUUID();
  });

  const [mode, setMode] = useState('auto'); // 'auto' | 'docs_only'
  const [inputQuery, setInputQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentSteps, setCurrentSteps] = useState([]);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const [showVoiceMode, setShowVoiceMode] = useState(false);

  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const streamAbortRef = useRef(null);

  const {
    speak,
    stopSpeaking,
    isSpeaking,
    startRecording,
    stopRecording,
    cancelRecording,
    isRecording,
    recordingSeconds
  } = useSpeech(token);

  // Auto-scroll to bottom of messages
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentSteps, scrollToBottom]);

  // Save session ID
  useEffect(() => {
    localStorage.setItem('chatSessionId', chatSessionId);
  }, [chatSessionId]);

  // Fetch session attachments
  const fetchAttachments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/chat/attachments/${chatSessionId}`, {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      if (res.ok) {
        const data = await res.json();
        setAttachments(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch attachments:', err);
    }
  }, [chatSessionId, token]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  // Reset Session
  const handleNewChat = useCallback(async () => {
    stopSpeaking();
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setIsStreaming(false);
    const newId = crypto.randomUUID();
    setChatSessionId(newId);
    setMessages([]);
    setAttachments([]);
    setCurrentSteps([]);
    setInputQuery('');
    setUploadError('');
  }, [stopSpeaking]);

  useEffect(() => {
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
    };
  }, []);

  // Document Upload
  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadError('');

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);
        formData.append('chat_session_id', chatSessionId);

        const res = await fetch(`${API_BASE_URL}/chat/upload`, {
          method: 'POST',
          headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: formData
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Failed to upload ${file.name}`);
        }
      }
      await fetchAttachments();
    } catch (err) {
      setUploadError(err.message || 'Error uploading file.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Remove single attachment
  const handleDeleteAttachment = async (filename) => {
    try {
      const res = await fetch(`${API_BASE_URL}/chat/attachments/${chatSessionId}/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      if (res.ok) {
        setAttachments((prev) => prev.filter((a) => a.filename !== filename));
      }
    } catch (err) {
      console.error('Failed to delete attachment:', err);
    }
  };

  // Voice recording handlers
  const handleStopRecording = async () => {
    if (!isRecording) return;
    try {
      const transcript = await stopRecording();
      if (transcript && transcript.trim()) {
        const cleanTranscript = transcript.trim();
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart ?? inputQuery.length;
          const end = textarea.selectionEnd ?? inputQuery.length;
          const before = inputQuery.substring(0, start);
          const after = inputQuery.substring(end);
          const spaceBefore = (before && !before.endsWith(' ') && !before.endsWith('\n')) ? ' ' : '';
          const spaceAfter = (after && !after.startsWith(' ') && !after.startsWith('\n')) ? ' ' : '';
          const newText = `${before}${spaceBefore}${cleanTranscript}${spaceAfter}${after}`;
          setInputQuery(newText);
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus();
              const newPos = start + spaceBefore.length + cleanTranscript.length;
              textareaRef.current.setSelectionRange(newPos, newPos);
            }
          }, 50);
        } else {
          setInputQuery((prev) => (prev ? `${prev} ${cleanTranscript}` : cleanTranscript));
        }
      }
    } catch (err) {
      setUploadError(err.message || 'Voice recording failed.');
    }
  };

  const handleCancelRecording = () => {
    cancelRecording();
  };

  const handleMicClick = async () => {
    if (isRecording) {
      await handleStopRecording();
    } else {
      try {
        setUploadError('');
        await startRecording();
      } catch (err) {
        setUploadError(err.message || 'Could not access microphone.');
      }
    }
  };

  // Voice playback toggle
  const handleToggleSpeak = (msgId, text) => {
    if (isSpeaking && speakingMessageId === msgId) {
      stopSpeaking();
      setSpeakingMessageId(null);
    } else {
      stopSpeaking();
      setSpeakingMessageId(msgId);
      speak(text);
    }
  };

  useEffect(() => {
    if (!isSpeaking) {
      setSpeakingMessageId(null);
    }
  }, [isSpeaking]);

  // Send message & stream response
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const query = inputQuery.trim();
    if (!query || isStreaming) return;

    setInputQuery('');
    setCurrentSteps([]);

    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();

    const userMessage = {
      id: userMsgId,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);

    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      const response = await fetch(`${API_BASE_URL}/chat/stream`, {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          query,
          chat_session_id: chatSessionId,
          mode
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to initiate chat stream.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      let finalAnswer = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          if (!evt.trim()) continue;
          const lines = evt.split('\n');
          let eventName = '';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.replace('event:', '').trim();
            } else if (line.startsWith('data:')) {
              dataStr += line.replace('data:', '').trim();
            }
          }

          if (eventName === 'step' && dataStr) {
            try {
              const stepData = JSON.parse(dataStr);
              setCurrentSteps((prev) => [...prev, stepData]);
            } catch {
              // ignore
            }
          } else if (eventName === 'answer' && dataStr) {
            try {
              finalAnswer = JSON.parse(dataStr);
            } catch {
              // ignore
            }
          } else if (eventName === 'error' && dataStr) {
            const errData = JSON.parse(dataStr);
            throw new Error(errData.message || 'Stream error occurred.');
          }
        }
      }

      if (finalAnswer) {
        const assistantMessage = {
          id: assistantMsgId,
          sender: 'assistant',
          text: finalAnswer.answer,
          sourcesUsed: finalAnswer.sources_used,
          citations: finalAnswer.citations || [],
          modeUsed: finalAnswer.mode,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;

      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          sender: 'assistant',
          text: `⚠️ ${err.message || 'Failed to get an answer. Please try again.'}`,
          sourcesUsed: 'Error',
          citations: [],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsStreaming(false);
      setCurrentSteps([]);
      streamAbortRef.current = null;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="chat-agent-page">
      {/* Ambient background glows */}
      <div className="ambient-glow-top-left" />
      <div className="ambient-glow-top-right" />

      {/* Top Header */}
      <header className="chat-header">
        <div className="chat-header-left">
          {navigateToFeed && (
            <button onClick={navigateToFeed} className="chat-back-btn" title="Back to Feed">
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="chat-title-group">
            <h1 className="chat-main-title">
              <Sparkles size={22} className="sparkle-icon" />
              <span className="chat-main-title-text">AI STUDIO CHATBOT</span>
            </h1>
          </div>
        </div>

        <div className="chat-header-actions">
          {/* Mode Switcher */}
          <div className="mode-toggle-group" role="radiogroup" aria-label="Answering Mode">
            <button
              type="button"
              className={`mode-btn ${mode === 'auto' ? 'active' : ''}`}
              onClick={() => setMode('auto')}
              title="Search documents first, then fallback to web search if needed"
            >
              <Layers size={14} />
              <span>Auto (Hybrid)</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'docs_only' ? 'active' : ''}`}
              onClick={() => setMode('docs_only')}
              title="Answer strictly from attached documents. Refuses if evidence is missing."
            >
              <FileCheck size={14} />
              <span>Docs Only</span>
            </button>
          </div>

          <button
            type="button"
            className="chat-voice-mode-btn"
            onClick={() => setShowVoiceMode(true)}
            title="Voice Mode"
            aria-label="Voice Mode"
          >
            <Headphones size={15} />
            <span className="btn-text">Voice Mode</span>
          </button>

          <button
            type="button"
            className="new-chat-btn"
            onClick={handleNewChat}
            title="Start New Session"
          >
            <RotateCcw size={15} />
            <span className="btn-text">New Session</span>
          </button>
        </div>
      </header>

      {/* Attachments Drawer / Bar */}
      <section className="attachments-bar" aria-label="Attached Documents">
        <div className="attachments-header">
          <div className="attachments-count">
            <FileText size={15} />
            <span>Attached Documents ({attachments.length})</span>
          </div>

          <label className={`attach-file-label ${isUploading ? 'uploading' : ''}`}>
            <Paperclip size={14} />
            <span>{isUploading ? 'Indexing Chunks...' : '+ Attach PDF, DOCX, TXT, MD'}</span>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".pdf,.docx,.txt,.md"
              multiple
              disabled={isUploading}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {uploadError && (
          <div className="upload-error-banner">
            <AlertCircle size={15} />
            <span>{uploadError}</span>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="attachment-chips-list">
            {attachments.map((att) => (
              <div key={att.filename} className="attachment-chip">
                <FileText size={13} className="chip-icon" />
                <span className="chip-name" title={att.filename}>{att.filename}</span>
                <span className="chip-count">{att.chunk_count} chunk{att.chunk_count > 1 ? 's' : ''}</span>
                <button
                  type="button"
                  onClick={() => handleDeleteAttachment(att.filename)}
                  className="chip-remove-btn"
                  title="Remove document"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Messages Scroll Area */}
      <main className="chat-messages-container">
        {messages.length === 0 && !isStreaming && (
          <div className="chat-empty-state">
            <div className="empty-icon-wrapper">
              <Sparkles size={28} className="empty-sparkle" />
            </div>
            <h2>What would you like to explore?</h2>
            <p>
              Attach your files for private, citation-backed answers, or search live web facts seamlessly.
            </p>
            <div className="suggestion-pills">
              <button 
                type="button"
                className="suggestion-pill"
                onClick={() => setInputQuery('Summarize key findings from the uploaded document')}
              >
                📄 "Summarize key findings from the uploaded document"
              </button>
              <button 
                type="button"
                className="suggestion-pill"
                onClick={() => setInputQuery('What are the latest technological developments this week?')}
              >
                🌐 "What are the latest technological developments this week?"
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isArabic = isArabicText(msg.text);
          return (
            <div
              key={msg.id}
              className={`message-row ${msg.sender === 'user' ? 'user-row' : 'assistant-row'}`}
            >
              <div
                className={`message-bubble ${msg.sender === 'user' ? 'user-bubble' : 'assistant-bubble'}`}
                dir={isArabic ? 'rtl' : 'ltr'}
              >
                {msg.sender === 'assistant' && (
                  <div className="assistant-bubble-header">
                    <div className="bubble-brand">
                      <Sparkles size={14} className="bubble-brand-icon" />
                      <span>SocialFeed AI</span>
                    </div>

                    <div className="bubble-meta-actions">
                      {msg.sourcesUsed && msg.sourcesUsed !== 'Error' && msg.sourcesUsed !== 'None' && (
                        <span className={`source-badge badge-${msg.sourcesUsed.toLowerCase().replace(/[\s+]+/g, '-')}`}>
                          {msg.sourcesUsed === 'Documents' && <FileCheck size={11} />}
                          {msg.sourcesUsed === 'Web' && <Globe size={11} />}
                          {msg.sourcesUsed === 'Documents + Web' && <Layers size={11} />}
                          <span>{msg.sourcesUsed}</span>
                        </span>
                      )}

                      <button
                        type="button"
                        className={`speak-btn ${isSpeaking && speakingMessageId === msg.id ? 'active' : ''}`}
                        onClick={() => handleToggleSpeak(msg.id, msg.text)}
                        title={isSpeaking && speakingMessageId === msg.id ? 'Stop reading' : 'Read aloud'}
                      >
                        {isSpeaking && speakingMessageId === msg.id ? (
                          <div className="active-soundwave" aria-label="Speaking">
                            <span className="wave-bar bar-1" />
                            <span className="wave-bar bar-2" />
                            <span className="wave-bar bar-3" />
                            <Square size={9} className="stop-sq-icon" />
                          </div>
                        ) : (
                          <Volume2 size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.text}
                  </ReactMarkdown>
                </div>

                {/* Citations section */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="citations-tray">
                    <span className="citations-label">Sources & References:</span>
                    <div className="citations-list">
                      {msg.citations.map((c, idx) => (
                        <div key={idx} className="citation-pill">
                          {c.type === 'document' ? (
                            <>
                              <FileText size={12} />
                              <span>{c.filename} {c.page ? `(p. ${c.page})` : ''}</span>
                            </>
                          ) : (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="web-citation-link"
                            >
                              <ExternalLink size={12} />
                              <span>{c.title || c.url}</span>
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="message-timestamp">{msg.timestamp}</div>
              </div>
            </div>
          );
        })}

        {/* Live Streaming Execution Steps */}
        {isStreaming && (
          <div className="message-row assistant-row">
            <div className="message-bubble assistant-bubble streaming-bubble">
              <div className="assistant-bubble-header">
                <div className="bubble-brand">
                  <Sparkles size={14} className="bubble-brand-icon spinning" />
                  <span>Synthesizing Answer...</span>
                </div>
              </div>

              <div className="stepper-feed">
                {currentSteps.map((step, idx) => (
                  <div key={idx} className="stepper-item">
                    <CheckCircle2 size={13} className="step-check-icon" />
                    <span className="step-status-text">{step.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Input Form Bar */}
      <footer className="chat-input-bar-container">
        {isRecording && (
          <div className="dictation-active-bar" role="status" aria-label="Audio Recording Active">
            <div className="dictation-status-info">
              <span className="rec-pulse-dot" />
              <div className="dictation-waveform">
                <span className="wave-bar bar-1" />
                <span className="wave-bar bar-2" />
                <span className="wave-bar bar-3" />
                <span className="wave-bar bar-4" />
              </div>
              <span className="dictation-timer">{recordingSeconds}s</span>
              <span className="dictation-hint">Listening... (Arabic or English)</span>
            </div>

            <div className="dictation-actions">
              <button
                type="button"
                className="dictation-cancel-btn"
                onClick={handleCancelRecording}
                title="Discard recording without inserting"
              >
                <X size={13} />
                <span>Cancel</span>
              </button>
              <button
                type="button"
                className="dictation-done-btn"
                onClick={handleStopRecording}
                title="Finish recording and insert text"
              >
                <Check size={13} />
                <span>Done</span>
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSendMessage} className="chat-input-form">
          <div className="input-textarea-wrapper">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === 'docs_only'
                  ? 'Ask anything strictly from your attached documents...'
                  : 'Ask about your documents, live web facts, or anything else...'
              }
              className="chat-textarea"
              dir={isArabicText(inputQuery) ? 'rtl' : 'ltr'}
              disabled={isStreaming}
            />

            <div className="input-actions-tray">
              {/* Voice Input Mic Button */}
              <button
                type="button"
                className={`voice-record-btn ${isRecording ? 'recording' : ''}`}
                onClick={handleMicClick}
                disabled={isStreaming}
                title={isRecording ? `Recording (${recordingSeconds}s) - click to stop` : 'Record voice query'}
              >
                {isRecording ? (
                  <>
                    <Square size={14} className="mic-stop-icon" />
                    <span className="rec-timer">{recordingSeconds}s</span>
                  </>
                ) : (
                  <Mic size={17} />
                )}
              </button>

              {/* Submit Button */}
              <button
                type="submit"
                className="chat-submit-btn"
                disabled={!inputQuery.trim() || isStreaming}
                title="Send query"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </form>
      </footer>

      {/* Real-time Bidirectional Voice Assistant Mode */}
      <VoiceModeView 
        isOpen={showVoiceMode} 
        onClose={() => setShowVoiceMode(false)} 
      />
    </div>
  );
}
