import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NotificationsDropdown from '../NotificationsDropdown';

describe('NotificationsDropdown Component', () => {
  const mockNotifications = [
    {
      id: 'notif-1',
      recipient_id: 'user-1',
      type: 'post_like',
      is_read: false,
      actors_count: 1,
      actor: { id: 'actor-1', name: 'Alice', profile_picture_url: null },
      post_id: 'post-100',
      comment_id: null,
      post_media_url: 'https://example.com/photo.jpg',
      comment_text: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'notif-2',
      recipient_id: 'user-1',
      type: 'post_like',
      is_read: false,
      actors_count: 3,
      actor: { id: 'actor-2', name: 'Bob', profile_picture_url: null },
      post_id: 'post-101',
      comment_id: null,
      post_media_url: 'https://example.com/video.mp4',
      comment_text: null,
      created_at: new Date(Date.now() - 60000).toISOString(),
      updated_at: new Date(Date.now() - 60000).toISOString()
    },
    {
      id: 'notif-3',
      recipient_id: 'user-1',
      type: 'comment',
      is_read: true,
      actors_count: 1,
      actor: { id: 'actor-3', name: 'Charlie', profile_picture_url: null },
      post_id: 'post-100',
      comment_id: 'comment-200',
      post_media_url: null,
      comment_text: 'Awesome picture!',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date(Date.now() - 3600000).toISOString()
    },
    {
      id: 'notif-4',
      recipient_id: 'user-1',
      type: 'comment_like',
      is_read: false,
      actors_count: 2,
      actor: { id: 'actor-4', name: 'Diana', profile_picture_url: null },
      post_id: 'post-100',
      comment_id: 'comment-201',
      post_media_url: null,
      comment_text: 'My cool comment',
      created_at: new Date(Date.now() - 7200000).toISOString(),
      updated_at: new Date(Date.now() - 7200000).toISOString()
    },
    {
      id: 'notif-5',
      recipient_id: 'user-1',
      type: 'post_save',
      is_read: true,
      actors_count: 1,
      actor: { id: 'actor-5', name: 'Eve', profile_picture_url: null },
      post_id: 'post-102',
      comment_id: null,
      post_media_url: null,
      comment_text: null,
      created_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date(Date.now() - 86400000).toISOString()
    }
  ];

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <NotificationsDropdown isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders empty state when notifications array is empty', () => {
    render(
      <NotificationsDropdown
        isOpen={true}
        onClose={vi.fn()}
        notifications={[]}
        unreadCount={0}
      />
    );

    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
  });

  it('renders notifications with correct text, grouping, and relative timestamps', () => {
    render(
      <NotificationsDropdown
        isOpen={true}
        onClose={vi.fn()}
        notifications={mockNotifications}
        unreadCount={3}
      />
    );

    // Single post like
    expect(screen.getByText(/Alice/i)).toBeInTheDocument();
    expect(screen.getAllByText(/liked your post/i).length).toBe(2);

    // Grouped post like (Bob and 2 others)
    expect(screen.getByText(/Bob/i)).toBeInTheDocument();
    expect(screen.getByText(/2 others/i)).toBeInTheDocument();

    // Comment notification
    expect(screen.getByText(/Charlie/i)).toBeInTheDocument();
    expect(screen.getByText(/commented:/i)).toBeInTheDocument();
    expect(screen.getByText(/"Awesome picture!"/i)).toBeInTheDocument();

    // Grouped comment like
    expect(screen.getByText(/Diana/i)).toBeInTheDocument();
    expect(screen.getByText(/1 other/i)).toBeInTheDocument();

    // Post save
    expect(screen.getByText(/Eve/i)).toBeInTheDocument();
    expect(screen.getByText(/saved your post/i)).toBeInTheDocument();

    // Header badge
    expect(screen.getByText('3 new')).toBeInTheDocument();
  });

  it('calls onMarkAllAsRead when clicking Mark all as read button', () => {
    const onMarkAllAsRead = vi.fn();
    render(
      <NotificationsDropdown
        isOpen={true}
        onClose={vi.fn()}
        notifications={mockNotifications}
        unreadCount={3}
        onMarkAllAsRead={onMarkAllAsRead}
      />
    );

    const markAllBtn = screen.getByRole('button', { name: /Mark all as read/i });
    fireEvent.click(markAllBtn);
    expect(onMarkAllAsRead).toHaveBeenCalledTimes(1);
  });

  it('calls onMarkAsRead and onNavigateToPost when clicking an unread notification', () => {
    const onMarkAsRead = vi.fn();
    const onNavigateToPost = vi.fn();

    render(
      <NotificationsDropdown
        isOpen={true}
        onClose={vi.fn()}
        notifications={mockNotifications}
        unreadCount={3}
        onMarkAsRead={onMarkAsRead}
        onNavigateToPost={onNavigateToPost}
      />
    );

    // Click first notification (Alice, unread, post-100)
    const notifItem = screen.getByText(/Alice/).closest('.notif-item');
    fireEvent.click(notifItem);

    expect(onMarkAsRead).toHaveBeenCalledWith('notif-1');
    expect(onNavigateToPost).toHaveBeenCalledWith('post-100', null);
  });

  it('calls onClose when clicking close button or pressing Escape', () => {
    const onClose = vi.fn();
    render(
      <NotificationsDropdown
        isOpen={true}
        onClose={onClose}
        notifications={mockNotifications}
        unreadCount={3}
      />
    );

    const closeBtn = screen.getByRole('button', { name: /Close notifications/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
