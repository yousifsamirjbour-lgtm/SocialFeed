"""
Database Migration: 0003_create_voice_quotas.py
Creates 'voice_daily_quotas' table for tracking daily voice seconds and turns per user.
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
    print("=== Running Migration: 0003_create_voice_quotas ===")
    print(f"DATABASE_URL: {DATABASE_URL}")
    verify_safe_environment(DATABASE_URL)

    connect_args = {}
    if "asyncpg" in DATABASE_URL:
        connect_args["statement_cache_size"] = 0

    engine = create_async_engine(DATABASE_URL, connect_args=connect_args)
    async with engine.begin() as conn:
        is_sqlite = "sqlite" in DATABASE_URL.lower()

        if is_sqlite:
            print("Creating 'voice_daily_quotas' table for SQLite...")
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS voice_daily_quotas (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    usage_date DATE NOT NULL,
                    seconds_used INTEGER NOT NULL DEFAULT 0,
                    turns_count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, usage_date)
                );
            """))
            await conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_voice_daily_quotas_user_date
                    ON voice_daily_quotas(user_id, usage_date);
            """))
        else:
            print("Creating 'voice_daily_quotas' table for PostgreSQL...")
            sql_file_path = os.path.join(os.path.dirname(__file__), "0003_create_voice_quotas.sql")
            with open(sql_file_path, "r", encoding="utf-8") as f:
                sql_content = f.read()

            statements = [stmt.strip() for stmt in sql_content.split(";") if stmt.strip()]
            for stmt in statements:
                print(f"Executing: {stmt[:60]}...")
                await conn.execute(text(stmt))

    print("[SUCCESS] Migration 0003_create_voice_quotas completed successfully!")

if __name__ == "__main__":
    asyncio.run(run())
