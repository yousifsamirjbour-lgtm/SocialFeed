---
name: joupro-testing
description: >-
  Procedures, runbooks, and cheatsheets for testing the Joupro (SocialFeed) full-stack
  codebase (FastAPI + React 19 + PostgreSQL/SQLite). Use this skill whenever running,
  debugging, or creating tests for the backend (pytest, pytest-cov, isolated SQLite,
  FastAPI Users, mocked Cloudinary/LangGraph) or the frontend (Vitest, React Testing
  Library, JSDOM, mocked fetch).
---

# Joupro Testing Runbook & Cheatsheet

This skill outlines the testing architecture, isolation strategies, and procedures for the Joupro full-stack application.

---

## 1. Backend Testing Architecture (pytest)

### Isolated Database Strategy
- **Isolation Principle**: Tests must NEVER connect to PostgreSQL or touch the live database.
- **Engine Configuration**:
  - Use `sqlite+aiosqlite:///` pointing to a session-scoped temporary file (`tmp_path / "test.db"`).
  - Use `create_async_engine(DATABASE_URL, connect_args={"check_same_thread": False})`.
  - Override FastAPI dependencies: `app.dependency_overrides[get_async_session]` and `app.dependency_overrides[get_user_db]`.
- **Per-Test Table Teardown**:
  To prevent unique constraint collisions (e.g. `users.email`) across tests, clear all tables on fixture teardown:
  ```python
  @pytest_asyncio.fixture(autouse=True)
  async def override_dependencies(db_session):
      # setup dependency overrides
      yield
      app.dependency_overrides.clear()
      async with test_engine.begin() as conn:
          for table in reversed(Base.metadata.sorted_tables):
              await conn.execute(table.delete())
  ```

### Cross-Database Column Typing: `GUID` vs `Uuid`
- `fastapi-users`'s `SQLAlchemyBaseUserTableUUID` uses `GUID` (`CHAR(36)` with dashes in SQLite; native `UUID` in PostgreSQL).
- **Rule**: All foreign keys referencing `users.id` (`posts.user_id`, `likes.user_id`, `follows.follower_id`, `follows.followed_id`, `comments.user_id`, `saved_posts.user_id`) must use `Column(GUID, ForeignKey("users.id", ...))` from `fastapi_users_db_sqlalchemy.generics`.
- **Pitfall**: Using `Column(Uuid, ...)` causes SQLite to format foreign keys as 32-character unhyphenated hex, breaking relational joins in SQLite tests.

### Mocking External APIs & Disk I/O
- **Cloudinary**: Mock `backend.core.images.uploader.upload` (and `cloudinary.uploader.upload`) with a fake dictionary `{"secure_url": "...", "public_id": "..."}`.
- **Web Search Agent**: Mock `backend.api.search_route.get_search_agent` to return a mock agent with `ainvoke = AsyncMock(return_value={"messages": [MagicMock(content="...")]})`.
- **Avatar Uploads**: Avatar upload routes write to disk. In tests, patch `builtins.open` with `mock_open()` and `shutil.copyfileobj` to prevent creating files in `uploads/`.

---

## 2. Frontend Testing Architecture (Vitest + React Testing Library)

### Test Environment & JSDOM Setup
- Configured in `frontend/vite.config.js`:
  ```javascript
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: false,
  }
  ```
- **Setup File (`frontend/src/test/setup.js`)**:
  - Polyfill `window.scrollTo = vi.fn()`, `window.confirm = vi.fn(() => true)`, `window.alert = vi.fn()`.
  - Polyfill `URL.createObjectURL = vi.fn(() => 'blob:mock')` and `URL.revokeObjectURL = vi.fn()`.
  - Import `@testing-library/jest-dom/vitest`.

### Testing Guidelines
- **Form Submissions & Required Attributes**: When testing forms with HTML5 `required` attributes in React 19, ensure mock form data has non-empty values before triggering submit buttons so JSDOM form validation passes.
- **Fetch Mocking**: Use `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ... }) }))` and clean up with `afterEach(() => { cleanup(); vi.clearAllMocks(); })`.
- **Multi-State Coverage**: Every component/page test suite must test:
  1. Happy path (renders data, handles user clicks).
  2. Empty states (empty feeds, no followers, no search results).
  3. Error states (API failures, invalid input alerts).
  4. Loading states (uploading spinners, disabled buttons).

---

## 3. Quick Reference Commands

```powershell
# Backend: Run all tests with coverage
pytest --cov=backend --cov-report=term-missing --cov-fail-under=70

# Frontend: Run Vitest tests
cd frontend
npm test

# Frontend: Run with coverage
npm run test:coverage
```
