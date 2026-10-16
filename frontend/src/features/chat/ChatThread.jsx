import { useState, useEffect, useRef } from 'react';
import { getProfileImageUrl } from '../../config/api';

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMessageTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatThread({
  conversation,
  messages = [],
  loading = false,
  onSendMessage,
  onDeleteConversation,
  onNavigateToProfile,
  onBack,
  onOpenNewChat,
  currentUserId
}) {
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textInputRef = useRef(null);

  // Auto-scroll to bottom whenever messages change or conversation loads
  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus input when conversation is selected
  useEffect(() => {
    if (conversation) {
      textInputRef.current?.focus();
    }
  }, [conversation?.id]);

  const handleSend = async (e) => {
    e?.preventDefault();
    if ((!inputText.trim() && !selectedFile) || sending) return;

    setSending(true);
    try {
      await onSendMessage({
        text: inputText.trim(),
        file: selectedFile
      });
      setInputText('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      // Handled in parent
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 1. Empty State when no conversation is active
  if (!conversation) {
    return (
      <main className="dm-chat-area">
        <div className="dm-empty-state">
          <div className="dm-empty-icon-circle">
            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" strokeWidth="1.5" fill="none">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </div>
          <h2 className="dm-empty-title">Your Messages</h2>
          <p className="dm-empty-desc">
            Send private photos, documents, and messages to a friend or group.
          </p>
          <button type="button" className="dm-primary-btn" onClick={onOpenNewChat}>
            Send Message
          </button>
        </div>
      </main>
    );
  }

  const participant = conversation.participant || {};
  const avatar = getProfileImageUrl(participant.profile_picture_url);

  return (
    <main className="dm-chat-area" aria-label={`Conversation with ${participant.name}`}>
      {/* Header */}
      <div className="dm-chat-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            className="dm-back-btn"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2.5" fill="none">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <div
            className="dm-chat-header-user"
            onClick={() => onNavigateToProfile && onNavigateToProfile(participant.id)}
            title={`View ${participant.name}'s profile`}
          >
            <img
              src={avatar}
              alt={participant.name || 'User'}
              className="dm-chat-header-avatar"
              onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
            />
            <h3 className="dm-chat-header-name">{participant.name}</h3>
          </div>
        </div>

        <button
          type="button"
          className="dm-icon-btn"
          title="Delete conversation"
          aria-label="Delete conversation"
          onClick={() => {
            if (window.confirm(`Delete conversation with ${participant.name}? This will remove all messages.`)) {
              onDeleteConversation(conversation.id);
            }
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="dm-messages-container" role="log" aria-live="polite">
        {loading && messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#8e8e8e', padding: '20px' }}>Loading messages...</div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#8e8e8e', marginTop: 'auto', marginBottom: 'auto', padding: '20px' }}>
            <p>No messages here yet.</p>
            <p style={{ fontSize: '13px' }}>Send a message to start chatting with {participant.name}.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isSent = String(msg.sender_id) === String(currentUserId);
            const isImage = msg.attachment_url && (
              (msg.attachment_type && msg.attachment_type.startsWith('image/')) ||
              /\.(jpeg|jpg|png|gif|webp)$/i.test(msg.attachment_url)
            );

            return (
              <div
                key={msg.id}
                className={`dm-msg-wrapper ${isSent ? 'sent' : 'received'}`}
              >
                <div className="dm-msg-bubble">
                  {/* Inline Image Attachment */}
                  {isImage && (
                    <a
                      href={msg.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View full image"
                    >
                      <img
                        src={msg.attachment_url}
                        alt={msg.attachment_name || 'Attached photo'}
                        className="dm-attachment-img-preview"
                      />
                    </a>
                  )}

                  {/* Document / Raw Attachment */}
                  {msg.attachment_url && !isImage && (
                    <a
                      href={msg.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={msg.attachment_name || true}
                      className="dm-attachment-doc-card"
                    >
                      <div className="dm-doc-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                      </div>
                      <div className="dm-doc-info">
                        <span className="dm-doc-name">{msg.attachment_name || 'Document'}</span>
                        {msg.attachment_size && (
                          <span className="dm-doc-size">{formatFileSize(msg.attachment_size)}</span>
                        )}
                      </div>
                    </a>
                  )}

                  {/* Message Text */}
                  {msg.text && <div>{msg.text}</div>}
                </div>

                <div className="dm-msg-meta">
                  {formatMessageTime(msg.created_at)}
                  {isSent && (
                    <span style={{ marginLeft: '4px' }}>
                      {msg.is_read ? ' · Read' : ' · Sent'}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Input */}
      <div className="dm-composer-wrapper">
        {selectedFile && (
          <div className="dm-attachment-selected-pill">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <span>{selectedFile.name} ({formatFileSize(selectedFile.size)})</span>
            <button
              type="button"
              className="dm-pill-remove-btn"
              onClick={() => {
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              aria-label="Remove attachment"
            >
              ✕
            </button>
          </div>
        )}

        <form onSubmit={handleSend} className="dm-composer-bar">
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            accept="image/*,.pdf,.doc,.docx,.txt,.zip"
          />

          <button
            type="button"
            className="dm-icon-btn"
            style={{ padding: '6px', minWidth: '36px', minHeight: '36px' }}
            title="Attach photo or document"
            aria-label="Attach photo or document"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2" fill="none">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <input
            ref={textInputRef}
            type="text"
            className="dm-composer-input"
            placeholder="Message..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />

          <button
            type="submit"
            className="dm-send-btn"
            disabled={(!inputText.trim() && !selectedFile) || sending}
            aria-label="Send message"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </main>
  );
}
