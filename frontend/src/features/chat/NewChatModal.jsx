import { useState, useEffect, useRef } from 'react';
import { API_BASE_URL, getProfileImageUrl } from '../../config/api';

export default function NewChatModal({ isOpen, onClose, onSelectUser, token }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/users/search?q=${encodeURIComponent(query.trim())}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setResults(Array.isArray(data) ? data : []);
        }
      } catch {
        // Silently handle search error
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, token]);

  if (!isOpen) return null;

  return (
    <div className="dm-modal-overlay" onClick={onClose}>
      <div className="dm-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-header">
          <h3 className="dm-modal-title">New message</h3>
          <button type="button" className="dm-icon-btn" onClick={onClose} aria-label="Close modal">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="dm-modal-search">
          <span className="dm-modal-search-label">To:</span>
          <input
            ref={inputRef}
            type="text"
            className="dm-modal-input"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <ul className="dm-modal-users-list">
          {loading ? (
            <div className="dm-modal-empty">Searching users...</div>
          ) : results.length > 0 ? (
            results.map((u) => {
              const avatar = getProfileImageUrl(u.profile_picture_url);
              return (
                <li
                  key={u.id}
                  className="dm-modal-user-item"
                  onClick={() => onSelectUser(u)}
                >
                  <img
                    src={avatar}
                    alt={u.name}
                    className="dm-modal-user-avatar"
                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                  />
                  <span className="dm-modal-user-name">{u.name}</span>
                </li>
              );
            })
          ) : query.trim() ? (
            <div className="dm-modal-empty">No account found.</div>
          ) : (
            <div className="dm-modal-empty">Type a name to find people.</div>
          )}
        </ul>
      </div>
    </div>
  );
}
