import React, { useState, useEffect } from 'react';

export function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now - date) / 1000));

  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) return `${diffWeeks}w`;
  return date.toLocaleDateString();
}

let sharedListeners = new Set();
let sharedInterval = null;

export function subscribeSharedTick(callback) {
  sharedListeners.add(callback);
  if (!sharedInterval && typeof window !== 'undefined') {
    sharedInterval = setInterval(() => {
      sharedListeners.forEach((cb) => {
        try {
          cb();
        } catch {
          // Listener error guard
        }
      });
    }, 30000); // 30-second interval
  }
  return () => {
    sharedListeners.delete(callback);
    if (sharedListeners.size === 0 && sharedInterval) {
      clearInterval(sharedInterval);
      sharedInterval = null;
    }
  };
}

export const RelativeTime = React.memo(function RelativeTime({ dateString, className = 'notif-time' }) {
  const [formatted, setFormatted] = useState(() => formatRelativeTime(dateString));

  useEffect(() => {
    setFormatted(formatRelativeTime(dateString));

    const unsubscribe = subscribeSharedTick(() => {
      setFormatted(formatRelativeTime(dateString));
    });
    return unsubscribe;
  }, [dateString]);

  return <span className={className}>{formatted}</span>;
});

export default RelativeTime;
