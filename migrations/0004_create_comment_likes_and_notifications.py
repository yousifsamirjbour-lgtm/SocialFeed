"""
Database Migration: 0004_create_comment_likes_and_notifications.py
Creates 'comment_likes' and 'notifications' tables with proper indexes and constraints.
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
    print("=== Running Migration: 0004_create_comment_likes_and_notifications ===")
    print(f"DATABASE_URL: {DATABASE_URL}")
    verify_safe_environment(DATABASE_URL)

    connect_args = {}
    if "asyncpg" in DATABASE_URL:
        connect_args["statement_cache_size"] = 0

    engine = create_async_engine(DATABASE_URL, connect_args=connect_args)
    async with engine.begin() as conn:
        is_sqlite = "sqlite" in DATABASE_URL.lower()

        if is_sqlite:
            print("Creating 'comment_likes' and 'notifications' tables for SQLite...")
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS comment_likes (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, comment_id)
                );
            """))
            await conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_comment_likes_comment_id
                    ON comment_likes(comment_id);
            """))
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS notifications (
                    id TEXT PRIMARY KEY,
                    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    type TEXT NOT NULL,
                    post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
                    comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
                    is_read BOOLEAN NOT NULL DEFAULT 0,
                    extra_data TEXT DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """))
            await conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_notifications_recipient_updated
                    ON notifications(recipient_id, updated_at);
            """))
            await conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_notifications_unread
                    ON notifications(recipient_id, is_read);
            """))
            await conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_post_like
                    ON notifications(recipient_id, post_id, type) WHERE type = 'post_like';
            """))
            await conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_comment_like
                    ON notifications(recipient_id, comment_id, type) WHERE type = 'comment_like';
            """))
            await conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_post_save
                    ON notifications(recipient_id, post_id, type) WHERE type = 'post_save';
            """))
        else:
            print("Creating 'comment_likes' and 'notifications' tables for PostgreSQL...")
            sql_file_path = os.path.join(os.path.dirname(__file__), "0004_create_comment_likes_and_notifications.sql")
            with open(sql_file_path, "r", encoding="utf-8") as f:
                sql_content = f.read()

            statements = [stmt.strip() for stmt in sql_content.split(";") if stmt.strip()]
            for stmt in statements:
                print(f"Executing: {stmt[:60]}...")
                await conn.execute(text(stmt))

    print("[SUCCESS] Migration 0004_create_comment_likes_and_notifications completed successfully!")

if __name__ == "__main__":
    asyncio.run(run())
