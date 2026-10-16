import React, { useEffect, useRef, memo } from 'react';
import { getProfileImageUrl } from '../../config/api';
import RelativeTime from './RelativeTime';
import './NotificationsDropdown.css';

function renderNotificationText(notif) {
  const actorName = notif.actor?.name || 'Someone';
  const actorsCount = notif.actors_count || 1;
  const othersCount = actorsCount - 1;

  switch (notif.type) {
    case 'post_like':
      if (othersCount > 0) {
        return (
          <>
            <strong>{actorName}</strong> and{' '}
            <strong>{othersCount} {othersCount === 1 ? 'other' : 'others'}</strong>{' '}
            liked your post.
          </>
        );
      }
      return (
        <>
          <strong>{actorName}</strong> liked your post.
        </>
      );

    case 'comment':
      return (
        <>
          <strong>{actorName}</strong> commented:{' '}
          <span className="notif-snippet">
            "{notif.comment_text ? (notif.comment_text.length > 50 ? notif.comment_text.slice(0, 50) + '...' : notif.comment_text) : 'on your post'}"
          </span>
        </>
      );

    case 'post_save':
      return (
        <>
          <strong>{actorName}</strong> saved your post.
        </>
      );

    case 'comment_like':
      if (othersCount > 0) {
        return (
          <>
            <strong>{actorName}</strong> and{' '}
            <strong>{othersCount} {othersCount === 1 ? 'other' : 'others'}</strong>{' '}
            liked your comment
            {notif.comment_text && (
              <span className="notif-snippet">
                : "{notif.comment_text.length > 40 ? notif.comment_text.slice(0, 40) + '...' : notif.comment_text}"
              </span>
            )}.
          </>
        );
      }
      return (
        <>
          <strong>{actorName}</strong> liked your comment
          {notif.comment_text && (
            <span className="notif-snippet">
              : "{notif.comment_text.length > 40 ? notif.comment_text.slice(0, 40) + '...' : notif.comment_text}"
            </span>
          )}.
        </>
      );

    case 'chat_message':
      return (
        <>
          <strong>{actorName}</strong> sent you a message
          {notif.comment_text && (
            <span className="notif-snippet">
              : "{notif.comment_text.length > 40 ? notif.comment_text.slice(0, 40) + '...' : notif.comment_text}"
            </span>
          )}.
        </>
      );

    default:
      return (
        <>
          <strong>{actorName}</strong> interacted with your content.
        </>
      );
  }
}

function renderTypeIcon(type) {
  switch (type) {
    case 'post_like':
    case 'comment_like':
      return (
        <span className="notif-type-icon notif-icon-like" title="Like">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </span>
      );
    case 'comment':
      return (
        <span className="notif-type-icon notif-icon-comment" title="Comment">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z" />
          </svg>
        </span>
      );
    case 'post_save':
      return (
        <span className="notif-type-icon notif-icon-save" title="Saved">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" />
          </svg>
        </span>
      );
    case 'chat_message':
      return (
        <span className="notif-type-icon notif-icon-chat" title="Message" style={{ background: '#0095f6', color: '#fff' }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
          </svg>
        </span>
      );
    default:
      return null;
  }
}

// Memoized individual notification item row
const NotificationItem = memo(function NotificationItem({
  notif,
  onMarkAsRead,
  onNavigateToPost,
  onNavigateToChat,
  isNew = false
}) {
  const avatarSrc = getProfileImageUrl(notif.actor?.profile_picture_url);
  const postThumbnail = notif.post_url || notif.post_media_url;
  const isVideo = notif.post_file_type
    ? notif.post_file_type.startsWith('video')
    : Boolean(postThumbnail && /\.(mp4|webm|mov)$/i.test(postThumbnail));

  const handleClick = () => {
    if (!notif.is_read && onMarkAsRead) {
      onMarkAsRead(notif.id);
    }
    if (notif.type === 'chat_message' && onNavigateToChat) {
      const convId = notif.extra_data?.conversation_id;
      onNavigateToChat(convId, notif.actor);
    } else if (onNavigateToPost && notif.post_id) {
      onNavigateToPost(notif.post_id, notif.comment_id);
    }
  };

  return (
    <div
      className={`notif-item ${!notif.is_read ? 'unread' : 'read'} ${isNew ? 'notif-item-enter' : ''}`}
      role="article"
      onClick={handleClick}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className="notif-avatar-wrapper">
        <img
          src={avatarSrc}
          alt={notif.actor?.name || 'User'}
          className="notif-actor-avatar"
          onError={(e) => {
            e.currentTarget.src = '/default-avatar.svg';
          }}
        />
        {renderTypeIcon(notif.type)}
      </div>

      <div className="notif-content">
        <div className="notif-text">
          {renderNotificationText(notif)}
        </div>
        <RelativeTime
          dateString={notif.updated_at || notif.created_at}
          className="notif-time"
        />
      </div>

      {postThumbnail && (
        <div className="notif-media-preview">
          {isVideo ? (
            <div className="notif-video-thumb">
              <video src={postThumbnail} muted />
              <div className="notif-video-play-badge">▶</div>
            </div>
          ) : (
            <img
              src={postThumbnail}
              alt="Post thumbnail"
              className="notif-thumb-img"
            />
          )}
        </div>
      )}

      {!notif.is_read && (
        <div className="notif-unread-dot" title="Unread" />
      )}
    </div>
  );
});

export const NotificationsDropdown = memo(function NotificationsDropdown({
  isOpen,
  onClose,
  notifications = [],
  unreadCount = 0,
  loading = false,
  error = null,
  hasMore = false,
  onMarkAsRead,
  onMarkAllAsRead,
  onNavigateToPost,
  onNavigateToChat,
  onLoadMore,
  onRetry
}) {
  const panelRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const isInitialMountRef = useRef(true);

  // Close on click outside (desktop)
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        if (event.target.closest('.nav-notifications-btn')) return;
        onClose();
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Track initial set of notification IDs so existing items do not replay entrance animations
  useEffect(() => {
    if (notifications.length > 0) {
      if (isInitialMountRef.current) {
        notifications.forEach((n) => seenIdsRef.current.add(n.id));
        isInitialMountRef.current = false;
      }
    }
  }, [notifications]);

  if (!isOpen) return null;

  return (
    <div
      className="notifications-dropdown-container"
      ref={panelRef}
      role="dialog"
      aria-label="Notifications panel"
      aria-modal="false"
      dir="auto"
    >
      <div className="notifs-header">
        <div className="notifs-header-title-row">
          <h3 className="notifs-title">Notifications</h3>
          {unreadCount > 0 && (
            <span className="notifs-unread-badge-pill">
              {unreadCount} new
            </span>
          )}
        </div>

        <div className="notifs-header-actions">
          {unreadCount > 0 && (
            <button
              type="button"
              className="notifs-mark-all-btn"
              onClick={onMarkAllAsRead}
              title="Mark all notifications as read"
            >
              Mark all as read
            </button>
          )}
          <button
            type="button"
            className="notifs-close-btn"
            onClick={onClose}
            aria-label="Close notifications"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div className="notifs-body">
        {loading && notifications.length === 0 ? (
          <div className="notifs-skeleton-list">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="notif-skeleton-item">
                <div className="skeleton-avatar" />
                <div className="skeleton-lines">
                  <div className="skeleton-line-long" />
                  <div className="skeleton-line-short" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="notifs-error-state">
            <svg viewBox="0 0 24 24" width="32" height="32" stroke="#ed4956" strokeWidth="2" fill="none">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="notifs-error-msg">{error}</p>
            {onRetry && (
              <button type="button" className="notifs-retry-btn" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        ) : notifications.length === 0 ? (
          <div className="notifs-empty-state">
            <div className="notifs-empty-icon-wrap">
              <svg viewBox="0 0 24 24" width="36" height="36" stroke="currentColor" strokeWidth="1.5" fill="none">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <h4 className="notifs-empty-title">No notifications yet</h4>
            <p className="notifs-empty-desc">
              When people like, comment, or save your posts, you'll see them here.
            </p>
          </div>
        ) : (
          <div className="notifs-list" role="feed">
            {notifications.map((notif) => {
              const isNew = !seenIdsRef.current.has(notif.id);
              if (isNew) {
                seenIdsRef.current.add(notif.id);
              }

              return (
                <NotificationItem
                  key={notif.id}
                  notif={notif}
                  onMarkAsRead={onMarkAsRead}
                  onNavigateToPost={onNavigateToPost}
                  onNavigateToChat={onNavigateToChat}
                  isNew={isNew && !isInitialMountRef.current}
                />
              );
            })}

            {hasMore && onLoadMore && (
              <button
                type="button"
                className="notifs-load-more-btn"
                onClick={onLoadMore}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load earlier notifications'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default NotificationsDropdown;
