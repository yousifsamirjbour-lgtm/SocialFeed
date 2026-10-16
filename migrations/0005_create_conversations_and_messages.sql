-- Migration: 0005_create_conversations_and_messages.sql
-- Creates conversations and direct_messages tables for 1-on-1 direct messaging

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY,
    user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_text TEXT DEFAULT NULL,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_conversation_users UNIQUE (user1_id, user2_id)
);

CREATE INDEX IF NOT EXISTS ix_conversations_user1 ON conversations(user1_id);
CREATE INDEX IF NOT EXISTS ix_conversations_user2 ON conversations(user2_id);
CREATE INDEX IF NOT EXISTS ix_conversations_last_message_at ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS direct_messages (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT DEFAULT NULL,
    attachment_url VARCHAR(500) DEFAULT NULL,
    attachment_name VARCHAR(255) DEFAULT NULL,
    attachment_type VARCHAR(100) DEFAULT NULL,
    attachment_size INTEGER DEFAULT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_direct_messages_conversation_created ON direct_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS ix_direct_messages_sender ON direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS ix_direct_messages_unread ON direct_messages(conversation_id, is_read);
