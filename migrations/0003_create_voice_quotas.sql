-- Migration: 0003_create_voice_quotas.sql
-- Creates voice_daily_quotas table to enforce daily audio duration and turn limits.

CREATE TABLE IF NOT EXISTS voice_daily_quotas (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    seconds_used INTEGER NOT NULL DEFAULT 0,
    turns_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS ix_voice_daily_quotas_user_date
    ON voice_daily_quotas(user_id, usage_date);
