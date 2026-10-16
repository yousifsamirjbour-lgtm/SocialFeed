import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNotifications } from '../useNotifications';

describe('useNotifications Hook', () => {
  const fakeToken = 'test-token-123';

  beforeEach(() => {
    vi.clearAllMocks();
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
          json: async () => ({ unread_count: 2 })
        });
      }
      if (urlStr.includes('/read-all')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ message: 'All read', unread_count: 0 })
        });
      }
      if (urlStr.includes('/read')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ message: 'Read', unread_count: 0 })
        });
      }
      if (urlStr.includes('/notifications')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            unread_count: 2,
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
    expect(result.current.unreadCount).toBe(0);
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
});
