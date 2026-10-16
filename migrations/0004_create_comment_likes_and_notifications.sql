-- Migration: 0004_create_comment_likes_and_notifications.sql
-- Creates comment_likes and notifications tables

CREATE TABLE IF NOT EXISTS comment_likes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, comment_id)
);

CREATE INDEX IF NOT EXISTS ix_comment_likes_comment_id
    ON comment_likes(comment_id);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(32) NOT NULL,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    extra_data JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_notifications_recipient_updated
    ON notifications(recipient_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS ix_notifications_unread
    ON notifications(recipient_id, is_read);

-- Unique indexes to prevent duplicate notification entries
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_post_like
    ON notifications(recipient_id, post_id, type) WHERE type = 'post_like';

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_comment_like
    ON notifications(recipient_id, comment_id, type) WHERE type = 'comment_like';

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_post_save
    ON notifications(recipient_id, post_id, type) WHERE type = 'post_save';
