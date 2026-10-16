import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../../config/api';
import ConversationList from './ConversationList';
import ChatThread from './ChatThread';
import NewChatModal from './NewChatModal';
import './DirectMessagesPage.css';

export default function DirectMessagesPage({
  token,
  currentUserId,
  currentUserName,
  initialTargetUser = null,
  initialConversationId = null,
  onNavigateToProfile
}) {
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(initialConversationId || null);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const activeConversationIdRef = useRef(activeConversationId);

  // Keep ref synchronized with state for event listeners
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Fetch all conversations for user
  const fetchConversations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/conversations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(Array.isArray(data) ? data : []);
      }
    } catch {
      // Silently handle error
    } finally {
      setLoadingConversations(false);
    }
  }, [token]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Mark active conversation as read
  const markActiveConversationRead = useCallback(async (convId) => {
    if (!token || !convId) return;
    try {
      await fetch(`${API_BASE_URL}/conversations/${convId}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      });
      // Locally reset unread count on conversation
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
      );
    } catch {
      // Silently handle read error
    }
  }, [token]);

  // Fetch messages for active conversation
  const fetchMessages = useCallback(async (convId) => {
    if (!token || !convId) return;
    setLoadingMessages(true);
    try {
      const res = await fetch(`${API_BASE_URL}/conversations/${convId}/messages?limit=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        // Trigger read receipt
        markActiveConversationRead(convId);
      }
    } catch {
      // Silently handle fetch error
    } finally {
      setLoadingMessages(false);
    }
  }, [token, markActiveConversationRead]);

  // Handle active conversation change
  useEffect(() => {
    if (activeConversationId) {
      fetchMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId, fetchMessages]);

  // Handle initialTargetUser (from Profile page "Message" button)
  useEffect(() => {
    if (initialTargetUser && initialTargetUser.id && token) {
      (async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/conversations`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ recipient_id: initialTargetUser.id })
          });
          if (res.ok) {
            const conv = await res.json();
            setActiveConversationId(conv.id);
            setConversations((prev) => {
              if (prev.some((c) => c.id === conv.id)) return prev;
              return [conv, ...prev];
            });
          }
        } catch {
          // Silently handle
        }
      })();
    }
  }, [initialTargetUser, token]);

  // Real-time SSE Custom Event Listeners
  useEffect(() => {
    const handleIncomingChatMessage = (e) => {
      const msg = e.detail;
      if (!msg || !msg.conversation_id) return;

      const currentActiveId = activeConversationIdRef.current;
      const isCurrentActive = String(msg.conversation_id) === String(currentActiveId);

      // If viewing this thread, append message and mark as read
      if (isCurrentActive) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (String(msg.sender_id) !== String(currentUserId)) {
          markActiveConversationRead(msg.conversation_id);
        }
      }

      // Update sidebar conversation item preview and order
      setConversations((prev) => {
        const existingIdx = prev.findIndex((c) => String(c.id) === String(msg.conversation_id));
        const previewText = msg.text || (msg.attachment_name ? `Sent attachment: ${msg.attachment_name}` : 'Sent an attachment');
        const nowIso = msg.created_at || new Date().toISOString();

        if (existingIdx >= 0) {
          const target = { ...prev[existingIdx] };
          target.last_message_text = previewText;
          target.last_message_at = nowIso;
          target.last_message_sender_id = msg.sender_id;
          if (!isCurrentActive && String(msg.sender_id) !== String(currentUserId)) {
            target.unread_count = (target.unread_count || 0) + 1;
          }
          const filtered = prev.filter((_, idx) => idx !== existingIdx);
          return [target, ...filtered];
        } else {
          // If conversation wasn't in list yet, refetch to load complete participant record
          fetchConversations();
          return prev;
        }
      });
    };

    const handleMessagesRead = (e) => {
      const { conversation_id } = e.detail || {};
      if (String(conversation_id) === String(activeConversationIdRef.current)) {
        setMessages((prev) => prev.map((m) => ({ ...m, is_read: true })));
      }
    };

    const handleConversationDeleted = (e) => {
      const { conversation_id } = e.detail || {};
      if (conversation_id) {
        setConversations((prev) => prev.filter((c) => String(c.id) !== String(conversation_id)));
        if (String(conversation_id) === String(activeConversationIdRef.current)) {
          setActiveConversationId(null);
          setMessages([]);
        }
      }
    };

    window.addEventListener('socialfeed:chat_message', handleIncomingChatMessage);
    window.addEventListener('socialfeed:messages_read', handleMessagesRead);
    window.addEventListener('socialfeed:conversation_deleted', handleConversationDeleted);

    return () => {
      window.removeEventListener('socialfeed:chat_message', handleIncomingChatMessage);
      window.removeEventListener('socialfeed:messages_read', handleMessagesRead);
      window.removeEventListener('socialfeed:conversation_deleted', handleConversationDeleted);
    };
  }, [currentUserId, markActiveConversationRead, fetchConversations]);

  // Send message handler
  const handleSendMessage = async ({ text, file }) => {
    if (!token || !activeConversationId) return;

    const formData = new FormData();
    if (text) formData.append('text', text);
    if (file) formData.append('file', file);

    const res = await fetch(`${API_BASE_URL}/conversations/${activeConversationId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || 'Failed to send message.');
      throw new Error(err.detail || 'Failed to send message');
    }

    const newMsg = await res.json();
    setMessages((prev) => {
      if (prev.some((m) => m.id === newMsg.id)) return prev;
      return [...prev, newMsg];
    });

    // Update sidebar snippet
    setConversations((prev) => {
      const idx = prev.findIndex((c) => String(c.id) === String(activeConversationId));
      if (idx < 0) return prev;
      const target = { ...prev[idx] };
      target.last_message_text = newMsg.text || (newMsg.attachment_name ? `Sent attachment: ${newMsg.attachment_name}` : 'Sent an attachment');
      target.last_message_at = newMsg.created_at;
      target.last_message_sender_id = newMsg.sender_id;
      const filtered = prev.filter((_, i) => i !== idx);
      return [target, ...filtered];
    });
  };

  // Delete conversation handler
  const handleDeleteConversation = async (conversationId) => {
    if (!token || !conversationId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => String(c.id) !== String(conversationId)));
        if (String(conversationId) === String(activeConversationId)) {
          setActiveConversationId(null);
          setMessages([]);
        }
      }
    } catch {
      alert('Failed to delete conversation.');
    }
  };

  // Start chat with user selected from modal
  const handleSelectUser = async (user) => {
    if (!token || !user || !user.id) return;
    try {
      const res = await fetch(`${API_BASE_URL}/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ recipient_id: user.id })
      });
      if (res.ok) {
        const conv = await res.json();
        setIsNewChatOpen(false);
        setActiveConversationId(conv.id);
        setConversations((prev) => {
          if (prev.some((c) => String(c.id) === String(conv.id))) return prev;
          return [conv, ...prev];
        });
      }
    } catch {
      // Silently handle
    }
  };

  const activeConversation = conversations.find(
    (c) => String(c.id) === String(activeConversationId)
  );

  return (
    <div className="dm-page-wrapper">
      <div className={`dm-container ${activeConversationId ? 'has-active-chat' : ''}`}>
        <ConversationList
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={(id) => setActiveConversationId(id)}
          onOpenNewChat={() => setIsNewChatOpen(true)}
          onDeleteConversation={handleDeleteConversation}
          currentUserName={currentUserName}
        />

        <ChatThread
          conversation={activeConversation}
          messages={messages}
          loading={loadingMessages}
          onSendMessage={handleSendMessage}
          onDeleteConversation={handleDeleteConversation}
          onNavigateToProfile={onNavigateToProfile}
          onBack={() => setActiveConversationId(null)}
          onOpenNewChat={() => setIsNewChatOpen(true)}
          currentUserId={currentUserId}
        />
      </div>

      <NewChatModal
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        onSelectUser={handleSelectUser}
        token={token}
      />
    </div>
  );
}
