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
  const healthTimerRef = useRef(null);
  const wasHealthyRef = useRef(false);
  const lastRefetchTimeRef = useRef(0);
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(true);
  const broadcastChannelRef = useRef(null);
  const connectSSERef = useRef(null);
  const isPlannedReconnectRef = useRef(false);
  const lastFetchNotificationsTimeRef = useRef(0);

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
          const count = data.unread_count ?? 0;
          setUnreadCount((prev) => (prev === count ? prev : count));
          broadcast('UNREAD_COUNT', { count });
        }
      }
    } catch {
      // Ignore network errors on background poll
    }
  }, [token]);

  // Fetch notifications list with invisible background sync & reference preservation
  const fetchNotifications = useCallback(
    async ({ reset = false, background = false, offset = 0, limit = 20 } = {}) => {
      if (!token) return;

      // Deduplicate rapid repeated background fetches within 1500ms
      const now = Date.now();
      if (background && (now - lastFetchNotificationsTimeRef.current < 1500)) {
        return;
      }
      lastFetchNotificationsTimeRef.current = now;

      // Only show loading indicator on user-driven initial load or manual pagination, never during background sync
      if (!background) {
        setLoading(true);
        setError(null);
      }

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
        const incoming = data.notifications || [];

        if (isMountedRef.current) {
          if (reset) {
            setNotifications((prev) => {
              const prevMap = new Map(prev.map((n) => [n.id, n]));
              let hasChanges = prev.length !== incoming.length;

              const merged = incoming.map((item) => {
                const existing = prevMap.get(item.id);
                if (
                  existing &&
                  existing.updated_at === item.updated_at &&
                  existing.is_read === item.is_read &&
                  existing.actors_count === item.actors_count &&
                  existing.actor?.id === item.actor?.id &&
                  existing.comment_text === item.comment_text &&
                  existing.post_media_url === item.post_media_url
                ) {
                  return existing; // Preserve object reference!
                }
                hasChanges = true;
                return item;
              });

              if (!hasChanges) {
                return prev; // Preserve array reference!
              }
              return merged;
            });
          } else {
            setNotifications((prev) => {
              const existingIds = new Set(prev.map((n) => n.id));
              const fresh = incoming.filter((n) => !existingIds.has(n.id));
              if (fresh.length === 0) return prev;
              return [...prev, ...fresh];
            });
          }

          setUnreadCount((prev) => (prev === data.unread_count ? prev : (data.unread_count ?? 0)));
          setHasMore(incoming.length === limit);
        }
      } catch (err) {
        if (isMountedRef.current && !background) {
          setError(err.message || 'Error loading notifications');
        }
      } finally {
        if (isMountedRef.current && !background) {
          setLoading(false);
        }
      }
    },
    [token]
  );

  // Throttled background refetch helper (never more than once every ~30s)
  const throttledBackgroundRefetch = useCallback(() => {
    const now = Date.now();
    if (now - lastRefetchTimeRef.current < 30000) {
      return;
    }
    lastRefetchTimeRef.current = now;
    void fetchUnreadCount();
    void fetchNotifications({ reset: true, background: true });
  }, [fetchUnreadCount, fetchNotifications]);

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

  // Exponential backoff scheduler with jitter & rate-limiting protection
  const scheduleReconnect = useCallback(
    (rateLimitedRetryAfter = null) => {
      if (!token || !isMountedRef.current) return;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

      let delay;
      if (rateLimitedRetryAfter) {
        delay = Math.max(15000, rateLimitedRetryAfter * 1000);
      } else {
        // Exponential backoff with jitter, starting at ~1s and capped at ~30-60s
        const attempt = reconnectAttemptsRef.current;
        const jitter = Math.random() * 800;
        delay = Math.min(60000, 1000 * Math.pow(1.5, attempt) + jitter);
        reconnectAttemptsRef.current += 1;
      }

      reconnectTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        // Only refetch unread/list after reconnecting following a connection that had stayed healthy
        if (wasHealthyRef.current) {
          wasHealthyRef.current = false;
          throttledBackgroundRefetch();
        }
        connectSSERef.current?.();
      }, delay);
    },
    [token, throttledBackgroundRefetch]
  );

  // Connect SSE with short-lived ticket and single-stream per tab enforcement
  const connectSSE = useCallback(() => {
    if (!token || !isMountedRef.current) return;
    if (isConnectingRef.current) return;

    // Single active stream per tab: close existing before connecting
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (healthTimerRef.current) {
      clearTimeout(healthTimerRef.current);
      healthTimerRef.current = null;
    }

    isConnectingRef.current = true;

    // Request ephemeral single-use ticket
    fetch(`${API_BASE_URL}/notifications/ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (res) => {
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '15', 10);
          throw { is429: true, retryAfter };
        }
        if (!res.ok) throw new Error('Ticket generation failed');
        return res.json();
      })
      .then((ticketData) => {
        isConnectingRef.current = false;
        if (!isMountedRef.current || !ticketData.ticket) return;

        const ticket = ticketData.ticket;
        const streamUrl = `${API_BASE_URL}/notifications/stream?ticket=${encodeURIComponent(ticket)}`;
        const es = new EventSource(streamUrl);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (isMountedRef.current) {
            setIsConnected(true);
            // Reset backoff ONLY after connection has stayed healthy for >= 10s
            if (healthTimerRef.current) clearTimeout(healthTimerRef.current);
            healthTimerRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                reconnectAttemptsRef.current = 0;
                wasHealthyRef.current = true;
              }
            }, 10000);
          }
        };

        es.addEventListener('connected', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (typeof data.unread_count === 'number' && isMountedRef.current) {
              setUnreadCount((prev) => (prev === data.unread_count ? prev : data.unread_count));
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

        const handleIncomingNotification = (event) => {
          try {
            const raw = JSON.parse(event.data);
            const notifItem = raw.notification || raw;
            const unread = typeof raw.unread_count === 'number' ? raw.unread_count : notifItem.unread_count;

            if (isMountedRef.current && notifItem && notifItem.id) {
              setNotifications((prev) => {
                const idx = prev.findIndex((n) => n.id === notifItem.id);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = notifItem;
                  return updated;
                }
                return [notifItem, ...prev];
              });

              if (typeof unread === 'number') {
                setUnreadCount(unread);
              } else {
                setUnreadCount((prev) => prev + 1);
              }

              broadcast('NEW_NOTIFICATION', notifItem);

              if (typeof onNotificationReceived === 'function') {
                onNotificationReceived(notifItem);
              }
            }
          } catch {
            // Invalid payload
          }
        };

        es.addEventListener('notification', handleIncomingNotification);
        es.addEventListener('new_notification', handleIncomingNotification);

        es.addEventListener('notification_removed', (event) => {
          try {
            const data = JSON.parse(event.data);
            const removedId = data.notification_id || data.id;
            if (isMountedRef.current && removedId) {
              setNotifications((prev) => prev.filter((n) => n.id !== removedId));
              if (typeof data.unread_count === 'number') {
                setUnreadCount(data.unread_count);
              }
            }
          } catch {
            // Invalid payload
          }
        });

        es.addEventListener('reconnect', () => {
          // Clean planned server reconnect request: reconnect immediately without error backoff
          isPlannedReconnectRef.current = true;
          if (es) es.close();
          eventSourceRef.current = null;
          if (healthTimerRef.current) {
            clearTimeout(healthTimerRef.current);
            healthTimerRef.current = null;
          }
          if (isMountedRef.current) {
            setIsConnected(false);
            throttledBackgroundRefetch();
            connectSSERef.current?.();
          }
        });

        es.onerror = () => {
          // If this disconnect was part of a planned server reconnect, ignore error backoff
          if (isPlannedReconnectRef.current) {
            isPlannedReconnectRef.current = false;
            return;
          }
          if (es) es.close();
          eventSourceRef.current = null;
          if (healthTimerRef.current) {
            clearTimeout(healthTimerRef.current);
            healthTimerRef.current = null;
          }
          if (isMountedRef.current) {
            setIsConnected(false);
            scheduleReconnect();
          }
        };
      })
      .catch((err) => {
        isConnectingRef.current = false;
        if (isMountedRef.current) {
          setIsConnected(false);
          scheduleReconnect(err?.is429 ? err.retryAfter : null);
        }
      });
  }, [token, throttledBackgroundRefetch, scheduleReconnect, onNotificationReceived]);

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
      if (healthTimerRef.current) {
        clearTimeout(healthTimerRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [token, fetchUnreadCount]);

  // Re-check on tab visibility focus (throttled to at most once per 30s)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && token) {
        throttledBackgroundRefetch();
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
          connectSSERef.current?.();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [token, throttledBackgroundRefetch]);

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
      void fetchNotifications({ reset: true, background: false });
    }
  };
}
