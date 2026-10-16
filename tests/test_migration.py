import sqlite3
import pytest
from migrations.run_migration import sanitize_name_from_email, verify_safe_environment, run

def test_sanitize_name_from_email():
    # Normal email
    assert sanitize_name_from_email("john.doe@gmail.com") == "john.doe"
    
    # Under 2 characters -> padded with underscore
    assert sanitize_name_from_email("a@gmail.com") == "a_"
    assert len(sanitize_name_from_email("a@gmail.com")) == 2

    # Over 50 characters -> truncated to 50 characters
    long_prefix = "a" * 60
    long_email = f"{long_prefix}@gmail.com"
    sanitized = sanitize_name_from_email(long_email)
    assert len(sanitized) == 50
    assert sanitized == "a" * 50

def test_verify_safe_environment_allows_local_and_aborts_remote():
    # Localhost and sqlite should pass
    verify_safe_environment("sqlite+aiosqlite:///test.db")
    verify_safe_environment("postgresql+asyncpg://postgres:pass@localhost:5432/socialfeed")
    verify_safe_environment("postgresql+asyncpg://postgres:pass@127.0.0.1:5432/socialfeed")

    # Remote database MUST trigger SystemExit
    with pytest.raises(SystemExit):
        verify_safe_environment("postgresql+asyncpg://admin:pass@production.rds.amazonaws.com:5432/socialfeed")

    with pytest.raises(SystemExit):
        verify_safe_environment("postgresql+asyncpg://admin:pass@13.62.51.232:5432/socialfeed")

@pytest.mark.asyncio
async def test_migration_execution_on_test_db(tmp_path, monkeypatch):
    test_db_file = tmp_path / "test_migration.db"
    db_url = f"sqlite+aiosqlite:///{test_db_file.as_posix()}"
    monkeypatch.setattr("migrations.run_migration.DATABASE_URL", db_url)

    # Initialize SQLite table with existing users needing backfill
    conn = sqlite3.connect(test_db_file)
    conn.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT)")
    conn.execute("INSERT INTO users VALUES ('1', 'user1@gmail.com', NULL)")
    conn.execute("INSERT INTO users VALUES ('2', 'x@gmail.com', '')")
    long_email = "b" * 60 + "@gmail.com"
    conn.execute(f"INSERT INTO users VALUES ('3', '{long_email}', NULL)")
    conn.commit()
    conn.close()

    # Run migration
    await run()

    # Verify backfill results
    conn = sqlite3.connect(test_db_file)
    rows = conn.execute("SELECT id, email, name FROM users ORDER BY id").fetchall()
    conn.close()

    assert len(rows) == 3
    # user 1: normal
    assert rows[0][2] == "user1"
    # user 2: padded from 'x' to 'x_'
    assert rows[1][2] == "x_"
    # user 3: truncated to 50 chars
    assert len(rows[2][2]) == 50
    assert rows[2][2] == "b" * 50

@pytest.mark.asyncio
async def test_0004_migration_on_real_postgresql_schema():
    import os
    import uuid
    from dotenv import load_dotenv
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    load_dotenv(dotenv_path="backend/.env", override=True)
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url or "postgresql" not in db_url.lower():
        pytest.skip("PostgreSQL DATABASE_URL not configured.")

    temp_schema = f"test_migration_{uuid.uuid4().hex[:8]}"
    connect_args = {"statement_cache_size": 0} if "asyncpg" in db_url else {}
    try:
        engine = create_async_engine(db_url, connect_args=connect_args)
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.skip(f"PostgreSQL service unavailable on localhost: {e}")

    try:
        async with engine.begin() as conn:
            # 1. Create temporary schema and isolate search path
            await conn.execute(text(f"CREATE SCHEMA {temp_schema}"))
            await conn.execute(text(f"SET search_path TO {temp_schema}, public"))

            # 2. Create baseline tables (users, posts, comments)
            await conn.execute(text("""
                CREATE TABLE users (
                    id UUID PRIMARY KEY,
                    email VARCHAR(320) NOT NULL,
                    hashed_password VARCHAR(1024) NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    is_superuser BOOLEAN NOT NULL DEFAULT FALSE,
                    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
                    name VARCHAR(50) NOT NULL
                )
            """))
            await conn.execute(text("""
                CREATE TABLE posts (
                    id UUID PRIMARY KEY,
                    caption TEXT,
                    url VARCHAR NOT NULL,
                    file_type VARCHAR NOT NULL,
                    file_name VARCHAR NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
                )
            """))
            await conn.execute(text("""
                CREATE TABLE comments (
                    id UUID PRIMARY KEY,
                    text TEXT NOT NULL,
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """))

            # 3. Read and apply the real 0004 migration SQL file
            sql_path = os.path.join("migrations", "0004_create_comment_likes_and_notifications.sql")
            with open(sql_path, "r", encoding="utf-8") as f:
                migration_sql = f.read()

            for stmt in migration_sql.split(";"):
                stmt_clean = stmt.strip()
                if stmt_clean:
                    await conn.execute(text(stmt_clean))

            # 4. Verify tables exist in the schema
            tables_res = await conn.execute(text(f"""
                SELECT table_name FROM information_schema.tables 
                WHERE table_schema = '{temp_schema}'
            """))
            tables = {r[0] for r in tables_res.fetchall()}
            assert "comment_likes" in tables
            assert "notifications" in tables

            # 5. Verify indexes and unique partial constraints exist
            indexes_res = await conn.execute(text(f"""
                SELECT indexname FROM pg_indexes 
                WHERE schemaname = '{temp_schema}'
            """))
            indexes = {r[0] for r in indexes_res.fetchall()}
            assert "ix_comment_likes_comment_id" in indexes
            assert "ix_notifications_recipient_updated" in indexes
            assert "ix_notifications_unread" in indexes
            assert "uq_notifications_post_like" in indexes
            assert "uq_notifications_comment_like" in indexes
            assert "uq_notifications_post_save" in indexes

            # 6. Verify idempotency: running migration a second time succeeds without errors
            for stmt in migration_sql.split(";"):
                stmt_clean = stmt.strip()
                if stmt_clean:
                    await conn.execute(text(stmt_clean))

    finally:
        # 7. Drop temporary schema completely
        async with engine.begin() as conn:
            await conn.execute(text(f"DROP SCHEMA IF EXISTS {temp_schema} CASCADE"))
        await engine.dispose()
