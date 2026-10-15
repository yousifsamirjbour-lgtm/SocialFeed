"""
Database Migration: 0002_create_document_chunks.py
Enables pgvector and creates 'document_chunks' table with FTS GIN and HNSW vector indexes.
"""

import os
import sys
from urllib.parse import urlparse
import asyncio
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

load_dotenv(dotenv_path="backend/.env")
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:2003@localhost:5432/socialfeed")

def verify_safe_environment(db_url: str):
    """Safety check: Abort unless DATABASE_URL points to localhost, 127.0.0.1, sqlite, or supabase when explicitly configured."""
    clean_url = db_url.lower()
    if "sqlite" in clean_url:
        print("[SAFETY CHECK PASSED] Using local SQLite database.")
        return

    try:
        normalized = db_url.replace("+asyncpg", "").replace("+psycopg2", "")
        parsed = urlparse(normalized)
        hostname = (parsed.hostname or "").lower()
        if hostname not in ("localhost", "127.0.0.1", "::1", "db") and not hostname.endswith(".supabase.co") and not hostname.endswith(".supabase.com"):
            print(f"[FATAL SAFETY ABORT] Target host '{hostname}' is not recognized safe host!")
            sys.exit(1)
        print(f"[SAFETY CHECK PASSED] Target database host: {hostname}")
    except Exception as e:
        print(f"[FATAL SAFETY ABORT] Failed to parse DATABASE_URL safely: {e}")
        sys.exit(1)

async def run():
    print("=== Running Migration: 0002_create_document_chunks ===")
    print(f"DATABASE_URL: {DATABASE_URL}")
    verify_safe_environment(DATABASE_URL)

    connect_args = {}
    if "asyncpg" in DATABASE_URL:
        connect_args["statement_cache_size"] = 0

    engine = create_async_engine(DATABASE_URL, connect_args=connect_args)
    async with engine.begin() as conn:
        is_sqlite = "sqlite" in DATABASE_URL.lower()

        if is_sqlite:
            print("Creating 'document_chunks' table for SQLite...")
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS document_chunks (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    chat_session_id TEXT NOT NULL,
                    filename VARCHAR(255) NOT NULL,
                    page_number INTEGER,
                    chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    embedding TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_doc_user_sess ON document_chunks(user_id, chat_session_id)"))
            print("SQLite document_chunks table ready.")
        else:
            print("Enabling vector extension and creating PostgreSQL table...")
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            await conn.execute(text("""
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
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_chunks_user_session ON document_chunks(user_id, chat_session_id);"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_chunks_tsv ON document_chunks USING gin(tsv);"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);"))
            print("PostgreSQL document_chunks table and indexes ready.")

    await engine.dispose()
    print("=== Migration 0002 completed successfully ===")

if __name__ == "__main__":
    asyncio.run(run())
