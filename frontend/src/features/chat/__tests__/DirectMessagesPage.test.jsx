import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DirectMessagesPage from '../DirectMessagesPage';

describe('DirectMessagesPage Component', () => {
  const mockToken = 'mock-jwt-token';
  const mockUserId = 'user-111-uuid';
  const mockUserName = 'Alice';

  const mockConversations = [
    {
      id: 'conv-123',
      participant: {
        id: 'user-222-uuid',
        name: 'Bob',
        profile_picture_url: null
      },
      last_message_text: 'Hey Alice!',
      last_message_at: new Date().toISOString(),
      last_message_sender_id: 'user-222-uuid',
      unread_count: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  const mockMessages = [
    {
      id: 'msg-1',
      conversation_id: 'conv-123',
      sender_id: 'user-222-uuid',
      sender: { id: 'user-222-uuid', name: 'Bob' },
      text: 'Hey Alice!',
      attachment_url: null,
      is_read: false,
      created_at: new Date().toISOString()
    }
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url, options) => {
      const u = String(url);
      if (u.includes('/conversations/conv-123/messages')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messages: mockMessages, has_more: false })
        });
      }
      if (u.includes('/conversations/conv-123/read')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ message: 'Marked read', marked_read: 1 })
        });
      }
      if (u.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockConversations)
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });
  });

  it('renders conversations list and shows empty chat state by default', async () => {
    render(
      <DirectMessagesPage
        token={mockToken}
        currentUserId={mockUserId}
        currentUserName={mockUserName}
      />
    );

    // Sidebar should display current user name and conversation partner
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
      expect(screen.getByText('Bob')).toBeDefined();
      expect(screen.getByText('Hey Alice!')).toBeDefined();
    });

    // Right column empty state
    expect(screen.getByText('Your Messages')).toBeDefined();
  });

  it('opens conversation thread when clicked from sidebar', async () => {
    render(
      <DirectMessagesPage
        token={mockToken}
        currentUserId={mockUserId}
        currentUserName={mockUserName}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Bob'));

    // Should load thread with header and messages
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Message...')).toBeDefined();
      expect(screen.getByRole('button', { name: /send/i })).toBeDefined();
    });
  });

  it('sends a message when submitted from composer', async () => {
    render(
      <DirectMessagesPage
        token={mockToken}
        currentUserId={mockUserId}
        currentUserName={mockUserName}
        initialConversationId="conv-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Message...')).toBeDefined();
    });

    // Mock sending POST message
    global.fetch.mockImplementationOnce((url, options) => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'msg-2',
          conversation_id: 'conv-123',
          sender_id: mockUserId,
          sender: { id: mockUserId, name: mockUserName },
          text: 'Hello Bob! Replying back.',
          attachment_url: null,
          is_read: false,
          created_at: new Date().toISOString()
        })
      });
    });

    const input = screen.getByPlaceholderText('Message...');
    fireEvent.change(input, { target: { value: 'Hello Bob! Replying back.' } });

    const sendBtn = screen.getByRole('button', { name: /send/i });
    expect(sendBtn.disabled).toBe(false);

    fireEvent.click(sendBtn);

    await waitFor(() => {
      const elements = screen.getAllByText('Hello Bob! Replying back.');
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });
});
