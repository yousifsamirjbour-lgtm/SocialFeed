"""
Database Migration: 0005_create_conversations_and_messages.py
Creates 'conversations' and 'direct_messages' tables with proper indexes and constraints.
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
    print("=== Running Migration: 0005_create_conversations_and_messages ===")
    print(f"DATABASE_URL: {DATABASE_URL}")
    verify_safe_environment(DATABASE_URL)

    connect_args = {}
    if "asyncpg" in DATABASE_URL:
        connect_args["statement_cache_size"] = 0

    engine = create_async_engine(DATABASE_URL, connect_args=connect_args)
    async with engine.begin() as conn:
        is_sqlite = "sqlite" in DATABASE_URL.lower()

        if is_sqlite:
            print("Creating 'conversations' and 'direct_messages' tables for SQLite...")
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    user1_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    user2_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    last_message_text TEXT DEFAULT NULL,
                    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_message_sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user1_id, user2_id)
                );
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_user1 ON conversations(user1_id);"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_user2 ON conversations(user2_id);"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_last_message_at ON conversations(last_message_at);"))

            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS direct_messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    text TEXT DEFAULT NULL,
                    attachment_url VARCHAR(500) DEFAULT NULL,
                    attachment_name VARCHAR(255) DEFAULT NULL,
                    attachment_type VARCHAR(100) DEFAULT NULL,
                    attachment_size INTEGER DEFAULT NULL,
                    is_read BOOLEAN NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_direct_messages_conversation_created ON direct_messages(conversation_id, created_at);"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_direct_messages_sender ON direct_messages(sender_id);"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_direct_messages_unread ON direct_messages(conversation_id, is_read);"))
        else:
            print("Creating 'conversations' and 'direct_messages' tables for PostgreSQL...")
            sql_path = os.path.join(os.path.dirname(__file__), "0005_create_conversations_and_messages.sql")
            with open(sql_path, "r", encoding="utf-8") as f:
                sql_content = f.read()

            statements = [stmt.strip() for stmt in sql_content.split(";") if stmt.strip()]
            for stmt in statements:
                await conn.execute(text(stmt))

        print("[MIGRATION SUCCESS] 'conversations' and 'direct_messages' created and indexed successfully.")

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(run())
