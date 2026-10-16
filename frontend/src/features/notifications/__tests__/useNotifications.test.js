import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNotifications } from '../useNotifications';

describe('useNotifications Hook', () => {
  const fakeToken = 'test-token-123';

  beforeEach(() => {
    vi.clearAllMocks();
    let currentUnread = 2;
    global.fetch = vi.fn().mockImplementation((url) => {
      const urlStr = String(url);
      if (urlStr.includes('/ticket')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ticket: 'mock-ticket-123', expires_in: 30 })
        });
      }
      if (urlStr.includes('/unread-count')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ unread_count: currentUnread })
        });
      }
      if (urlStr.includes('/read-all')) {
        currentUnread = 0;
        return Promise.resolve({
          ok: true,
          json: async () => ({ message: 'All read', unread_count: 0 })
        });
      }
      if (urlStr.includes('/read')) {
        currentUnread = Math.max(0, currentUnread - 1);
        return Promise.resolve({
          ok: true,
          json: async () => ({ message: 'Read', unread_count: currentUnread })
        });
      }
      if (urlStr.includes('/notifications')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            unread_count: currentUnread,
            notifications: [
              { id: 'notif-1', type: 'post_like', is_read: false, post_id: 'p1' },
              { id: 'notif-2', type: 'comment', is_read: false, post_id: 'p2' }
            ]
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    // Mock EventSource
    global.EventSource = vi.fn(() => ({
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onerror: null
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default state when no token is provided', () => {
    const { result } = renderHook(() => useNotifications(''));

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches unread count and notifications on demand', async () => {
    const { result } = renderHook(() => useNotifications(fakeToken));

    await act(async () => {
      await result.current.fetchNotifications({ reset: true });
    });

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(2);
  });

  it('marks a single notification as read optimistically and sends API call', async () => {
    const { result } = renderHook(() => useNotifications(fakeToken));

    await act(async () => {
      await result.current.fetchNotifications({ reset: true });
    });

    expect(result.current.notifications[0].is_read).toBe(false);

    await act(async () => {
      await result.current.markAsRead('notif-1');
    });

    expect(result.current.notifications[0].is_read).toBe(true);
    expect(result.current.unreadCount).toBe(1);
  });

  it('marks all notifications as read and resets unread count to 0', async () => {
    const { result } = renderHook(() => useNotifications(fakeToken));

    await act(async () => {
      await result.current.fetchNotifications({ reset: true });
    });

    expect(result.current.unreadCount).toBe(2);

    await act(async () => {
      await result.current.markAllAsRead();
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notifications.every((n) => n.is_read)).toBe(true);
  });

  it('does not trigger loading state during invisible background sync', async () => {
    const { result } = renderHook(() => useNotifications(fakeToken));

    // Initial load: user-facing, loading is true during fetch
    expect(result.current.loading).toBe(false);

    let fetchPromise;
    act(() => {
      fetchPromise = result.current.fetchNotifications({ reset: true, background: true });
    });

    // During background fetch, loading MUST remain false (no skeleton/spinner)
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await fetchPromise;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.notifications).toHaveLength(2);
  });

  it('preserves object and array references when background refresh data is unchanged', async () => {
    const { result } = renderHook(() => useNotifications(fakeToken));

    await act(async () => {
      await result.current.fetchNotifications({ reset: true });
    });

    const initialArray = result.current.notifications;
    const initialItem0 = initialArray[0];
    const initialItem1 = initialArray[1];

    // Run background sync with identical data
    await act(async () => {
      await result.current.fetchNotifications({ reset: true, background: true });
    });

    // Exact reference equality check: array and objects must be identical
    expect(result.current.notifications).toBe(initialArray);
    expect(result.current.notifications[0]).toBe(initialItem0);
    expect(result.current.notifications[1]).toBe(initialItem1);
  });

  it('handles 429 response on ticket by honoring Retry-After delay', async () => {
    vi.useFakeTimers();

    global.fetch = vi.fn().mockImplementation((url) => {
      const urlStr = String(url);
      if (urlStr.includes('/ticket')) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '20' }),
          json: async () => ({ detail: 'Too many requests' })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ unread_count: 0 }) });
    });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    renderHook(() => useNotifications(fakeToken));

    // Allow promise resolution
    await vi.advanceTimersByTimeAsync(10);

    // Verify backoff scheduled for at least 20,000ms
    const timerCalls = setTimeoutSpy.mock.calls.map((c) => c[1]);
    const has429Delay = timerCalls.some((delay) => delay >= 20000);
    expect(has429Delay).toBe(true);

    vi.useRealTimers();
  });
});

