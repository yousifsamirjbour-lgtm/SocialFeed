"""
Database Migration Runner: 0001_add_name_to_users.py
Adds 'name' column to the 'users' table and backfills existing records.
"""

import os
import sys
from urllib.parse import urlparse
import asyncio
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Load environment variables from backend/.env or root .env
load_dotenv(dotenv_path="backend/.env")
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:2003@localhost:5432/socialfeed")

def sanitize_name_from_email(email: str) -> str:
    """Extract local part of email, pad if < 2 chars, truncate if > 50 chars."""
    if not email or "@" not in email:
        return "user"
    local_part = email.split("@")[0].strip()
    if len(local_part) < 2:
        local_part = local_part.ljust(2, "_")
    if len(local_part) > 50:
        local_part = local_part[:50]
    return local_part

def verify_safe_environment(db_url: str):
    """Safety check: Abort unless DATABASE_URL points to localhost, 127.0.0.1, or sqlite."""
    clean_url = db_url.lower()
    if "sqlite" in clean_url:
        print("[SAFETY CHECK PASSED] Using local SQLite database.")
        return

    # Check hostname for client/server databases (PostgreSQL)
    try:
        # Strip asyncpg prefix if present for parsing
        normalized = db_url.replace("+asyncpg", "").replace("+psycopg2", "")
        parsed = urlparse(normalized)
        hostname = (parsed.hostname or "").lower()
        if hostname not in ("localhost", "127.0.0.1", "::1", "db"):
            print(f"[FATAL SAFETY ABORT] Target host '{hostname}' is not localhost or a test database!")
            print("To protect production, this migration script refuses to run on non-local hosts.")
            sys.exit(1)
        print(f"[SAFETY CHECK PASSED] Target database is local host: {hostname}")
    except Exception as e:
        print(f"[FATAL SAFETY ABORT] Failed to parse DATABASE_URL safely: {e}")
        sys.exit(1)

async def run():
    print("=== Running Migration: 0001_add_name_to_users ===")
    print(f"DATABASE_URL: {DATABASE_URL}")
    verify_safe_environment(DATABASE_URL)

    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        is_sqlite = "sqlite" in DATABASE_URL.lower()

        if is_sqlite:
            # SQLite Column Inspection
            pragma = await conn.execute(text("PRAGMA table_info(users)"))
            columns = [row[1] for row in pragma.fetchall()]
            if "name" not in columns:
                print("Adding 'name' column to SQLite users table...")
                await conn.execute(text("ALTER TABLE users ADD COLUMN name VARCHAR(50)"))
            else:
                print("'name' column already exists in SQLite users table.")

            # Backfill existing SQLite users
            result = await conn.execute(text("SELECT id, email, name FROM users"))
            users = result.fetchall()
            for u_id, u_email, u_name in users:
                if not u_name or not str(u_name).strip():
                    new_name = sanitize_name_from_email(u_email)
                    await conn.execute(
                        text("UPDATE users SET name = :name WHERE id = :id"),
                        {"name": new_name, "id": u_id}
                    )
                    print(f"  Backfilled user {u_email} -> '{new_name}'")

        else:
            # PostgreSQL Migration
            print("Checking/adding 'name' column on PostgreSQL...")
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(50);"))

            # Query existing users needing backfill
            result = await conn.execute(text("SELECT id, email FROM users WHERE name IS NULL OR name = ''"))
            users = result.fetchall()
            for u_id, u_email in users:
                new_name = sanitize_name_from_email(u_email)
                await conn.execute(
                    text("UPDATE users SET name = :name WHERE id = :id"),
                    {"name": new_name, "id": u_id}
                )
                print(f"  Backfilled user {u_email} -> '{new_name}'")

            # Set NOT NULL
            print("Setting NOT NULL constraint on users.name...")
            await conn.execute(text("ALTER TABLE users ALTER COLUMN name SET NOT NULL;"))

    await engine.dispose()
    print("=== Migration Completed Successfully! ===")

if __name__ == "__main__":
    asyncio.run(run())
