import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../../config/api';

const BROADCAST_CHANNEL_NAME = 'socialfeed_notifications_sync';

export function useNotifications(token, onNotificationReceived) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [prevToken, setPrevToken] = useState(token);

  // Synchronously reset state during render when user logs out
  if (token !== prevToken) {
    setPrevToken(token);
    if (!token) {
      setNotifications([]);
      setUnreadCount(0);
      setIsConnected(false);
    }
  }

  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isMountedRef = useRef(true);
  const broadcastChannelRef = useRef(null);
  const connectSSERef = useRef(null);

  // Initialize BroadcastChannel for multi-tab synchronization
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        broadcastChannelRef.current = bc;
        bc.onmessage = (event) => {
          const { type, payload } = event.data || {};
          if (!isMountedRef.current) return;

          if (type === 'NEW_NOTIFICATION') {
            setNotifications((prev) => {
              const existingIndex = prev.findIndex((n) => n.id === payload.id);
              if (existingIndex >= 0) {
                const updated = [...prev];
                updated[existingIndex] = payload;
                return updated;
              }
              return [payload, ...prev];
            });
            if (typeof payload.unread_count === 'number') {
              setUnreadCount(payload.unread_count);
            } else {
              setUnreadCount((prev) => prev + 1);
            }
          } else if (type === 'READ_ONE') {
            setNotifications((prev) =>
              prev.map((n) => (n.id === payload.id ? { ...n, is_read: true } : n))
            );
            if (typeof payload.unreadCount === 'number') {
              setUnreadCount(payload.unreadCount);
            } else {
              setUnreadCount((prev) => Math.max(0, prev - 1));
            }
          } else if (type === 'READ_ALL') {
            setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
            setUnreadCount(0);
          } else if (type === 'UNREAD_COUNT') {
            if (typeof payload.count === 'number') {
              setUnreadCount(payload.count);
            }
          }
        };
      } catch {
        // Fallback or ignore if unsupported
      }
    }

    return () => {
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
        broadcastChannelRef.current = null;
      }
    };
  }, []);

  const broadcast = (type, payload) => {
    if (broadcastChannelRef.current) {
      try {
        broadcastChannelRef.current.postMessage({ type, payload });
      } catch {
        // BroadcastChannel failed silently
      }
    }
  };

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (isMountedRef.current) {
          setUnreadCount(data.unread_count ?? 0);
          broadcast('UNREAD_COUNT', { count: data.unread_count ?? 0 });
        }
      }
    } catch {
      // Ignore network errors on background poll
    }
  }, [token]);

  // Fetch notifications list
  const fetchNotifications = useCallback(
    async ({ reset = false, offset = 0, limit = 20 } = {}) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const currentOffset = reset ? 0 : offset;
        const res = await fetch(
          `${API_BASE_URL}/notifications?limit=${limit}&offset=${currentOffset}`,
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        if (!res.ok) throw new Error('Failed to load notifications');
        const data = await res.json();
        if (isMountedRef.current) {
          if (reset) {
            setNotifications(data.notifications || []);
          } else {
            setNotifications((prev) => {
              const existingIds = new Set(prev.map((n) => n.id));
              const fresh = (data.notifications || []).filter((n) => !existingIds.has(n.id));
              return [...prev, ...fresh];
            });
          }
          setUnreadCount(data.unread_count ?? 0);
          setHasMore((data.notifications || []).length === limit);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(err.message || 'Error loading notifications');
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [token]
  );

  // Mark single notification as read
  const markAsRead = useCallback(
    async (notificationId) => {
      if (!token || !notificationId) return;

      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      try {
        const res = await fetch(`${API_BASE_URL}/notifications/${notificationId}/read`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.unread_count === 'number' && isMountedRef.current) {
            setUnreadCount(data.unread_count);
            broadcast('READ_ONE', { id: notificationId, unreadCount: data.unread_count });
          }
        }
      } catch {
        // Rollback unread count if needed
      }
    },
    [token]
  );

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!token) return;

    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    broadcast('READ_ALL', {});

    try {
      const res = await fetch(`${API_BASE_URL}/notifications/read-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.unread_count === 'number' && isMountedRef.current) {
          setUnreadCount(data.unread_count);
        }
      }
    } catch {
      // Silently handle
    }
  }, [token]);

  // Connect SSE with short-lived ticket
  const connectSSE = useCallback(() => {
    if (!token || !isMountedRef.current) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Step 1: Request ephemeral single-use ticket (no tokens logged or in URL)
    fetch(`${API_BASE_URL}/notifications/ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => {
        if (!res.ok) throw new Error('Ticket generation failed');
        return res.json();
      })
      .then((ticketData) => {
        if (!isMountedRef.current || !ticketData.ticket) return;

        const ticket = ticketData.ticket;
        const streamUrl = `${API_BASE_URL}/notifications/stream?ticket=${encodeURIComponent(ticket)}`;
        const es = new EventSource(streamUrl);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (isMountedRef.current) {
            setIsConnected(true);
            reconnectAttemptsRef.current = 0;
          }
        };

        es.addEventListener('connected', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (typeof data.unread_count === 'number' && isMountedRef.current) {
              setUnreadCount(data.unread_count);
            }
          } catch {
            // Invalid payload
          }
        });

        es.addEventListener('unread_count', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (typeof data.unread_count === 'number' && isMountedRef.current) {
              setUnreadCount(data.unread_count);
              broadcast('UNREAD_COUNT', { count: data.unread_count });
            }
          } catch {
            // Invalid payload
          }
        });

        es.addEventListener('notification', (event) => {
          try {
            const newNotif = JSON.parse(event.data);
            if (isMountedRef.current) {
              setNotifications((prev) => {
                const idx = prev.findIndex((n) => n.id === newNotif.id);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = newNotif;
                  return updated;
                }
                return [newNotif, ...prev];
              });

              if (typeof newNotif.unread_count === 'number') {
                setUnreadCount(newNotif.unread_count);
              } else {
                setUnreadCount((prev) => prev + 1);
              }

              broadcast('NEW_NOTIFICATION', newNotif);

              if (typeof onNotificationReceived === 'function') {
                onNotificationReceived(newNotif);
              }
            }
          } catch {
            // Invalid payload
          }
        });

        es.addEventListener('reconnect', () => {
          // Clean reconnect request from server
          if (es) es.close();
          if (isMountedRef.current) {
            setIsConnected(false);
            // Refetch unread count and latest notifications after reconnect as required
            void fetchUnreadCount();
            void fetchNotifications({ reset: true });
            connectSSERef.current?.();
          }
        });

        es.onerror = () => {
          if (es) es.close();
          if (isMountedRef.current) {
            setIsConnected(false);
            const backoff = Math.min(15000, 1000 * Math.pow(2, reconnectAttemptsRef.current));
            reconnectAttemptsRef.current += 1;
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                // Reconnect & refetch unread count and notifications
                void fetchUnreadCount();
                void fetchNotifications({ reset: true });
                connectSSERef.current?.();
              }
            }, backoff);
          }
        };
      })
      .catch(() => {
        // Ticket request failed; retry with backoff
        if (isMountedRef.current) {
          setIsConnected(false);
          const backoff = Math.min(15000, 1000 * Math.pow(2, reconnectAttemptsRef.current));
          reconnectAttemptsRef.current += 1;
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) connectSSERef.current?.();
          }, backoff);
        }
      });
  }, [token, fetchUnreadCount, fetchNotifications, onNotificationReceived]);

  // Keep ref up to date
  useEffect(() => {
    connectSSERef.current = connectSSE;
  }, [connectSSE]);

  // Initial connection and teardown
  useEffect(() => {
    isMountedRef.current = true;
    let initialTimer = null;
    if (token) {
      initialTimer = setTimeout(() => {
        void fetchUnreadCount();
      }, 0);
      connectSSERef.current?.();
    } else {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }

    return () => {
      isMountedRef.current = false;
      if (initialTimer) {
        clearTimeout(initialTimer);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [token, fetchUnreadCount]);

  // Re-check on tab visibility focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && token) {
        void fetchUnreadCount();
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
          connectSSERef.current?.();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [token, fetchUnreadCount]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    isConnected,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    refetch: () => {
      void fetchUnreadCount();
      void fetchNotifications({ reset: true });
    }
  };
}
