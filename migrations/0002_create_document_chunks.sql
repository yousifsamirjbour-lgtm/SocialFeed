-- Migration: 0002_create_document_chunks.sql
-- Enables pgvector and creates document_chunks table with FTS GIN and HNSW vector indexes.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_session_id UUID NOT NULL,
    filename VARCHAR(255) NOT NULL,
    page_number INTEGER,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    embedding vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for scoping retrieval per user and chat session
CREATE INDEX IF NOT EXISTS ix_document_chunks_user_session 
    ON document_chunks(user_id, chat_session_id);

-- GIN index for fast lexical full-text search (universal Arabic and English via 'simple')
CREATE INDEX IF NOT EXISTS ix_document_chunks_tsv 
    ON document_chunks USING gin(to_tsvector('simple', content));

-- HNSW index for high-performance semantic vector cosine search
CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding 
    ON document_chunks USING hnsw (embedding vector_cosine_ops);
