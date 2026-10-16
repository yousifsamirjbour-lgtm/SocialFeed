import { useState, useMemo } from 'react';
import { getProfileImageUrl } from '../../config/api';

function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const now = new Date();
  const date = new Date(isoString);
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return 'now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return `${Math.floor(diffDay / 7)}w`;
}

export default function ConversationList({
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onOpenNewChat,
  onDeleteConversation,
  currentUserName
}) {
  const [filterQuery, setFilterQuery] = useState('');

  const filteredConversations = useMemo(() => {
    if (!filterQuery.trim()) return conversations;
    const q = filterQuery.toLowerCase();
    return conversations.filter((c) =>
      c.participant?.name?.toLowerCase().includes(q)
    );
  }, [conversations, filterQuery]);

  return (
    <aside className="dm-sidebar" aria-label="Direct Messages Conversations">
      <div className="dm-sidebar-header">
        <h2 className="dm-current-username">{currentUserName || 'Messages'}</h2>
        <button
          type="button"
          className="dm-icon-btn"
          onClick={onOpenNewChat}
          title="New message"
          aria-label="New message"
        >
          {/* Instagram-style edit/compose icon */}
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2" fill="none">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      <div className="dm-search-bar-wrap">
        <div className="dm-search-input-box">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="dm-search-input"
            placeholder="Search conversations..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
        </div>
      </div>

      <ul className="dm-conversations-list">
        {filteredConversations.length > 0 ? (
          filteredConversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const hasUnread = conv.unread_count > 0;
            const avatar = getProfileImageUrl(conv.participant?.profile_picture_url);

            return (
              <li
                key={conv.id}
                className={`dm-conv-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectConversation(conv.id)}
              >
                <div className="dm-conv-avatar-wrap">
                  <img
                    src={avatar}
                    alt={conv.participant?.name || 'User'}
                    className="dm-conv-avatar"
                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                  />
                  {hasUnread && <span className="dm-conv-unread-dot" />}
                </div>

                <div className="dm-conv-content">
                  <div className="dm-conv-top-row">
                    <span className="dm-conv-name">{conv.participant?.name}</span>
                    <span className="dm-conv-time">{formatTimeAgo(conv.last_message_at)}</span>
                  </div>
                  <div className="dm-conv-preview-row">
                    <p className={`dm-conv-snippet ${hasUnread ? 'unread-bold' : ''}`}>
                      {conv.last_message_text || 'Started a conversation'}
                    </p>
                    <button
                      type="button"
                      className="dm-conv-delete-btn"
                      title="Delete conversation"
                      aria-label="Delete conversation"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete conversation with ${conv.participant?.name}?`)) {
                          onDeleteConversation(conv.id);
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              </li>
            );
          })
        ) : (
          <div className="dm-sidebar-empty">
            {filterQuery.trim() ? 'No conversations found.' : 'No messages yet.'}
          </div>
        )}
      </ul>
    </aside>
  );
}
