import os
import uuid
import tempfile
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

# Set up test environment variables before importing app modules
test_db_dir = tempfile.mkdtemp()
test_db_file = os.path.join(test_db_dir, "test.db").replace("\\", "/")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{test_db_file}"
os.environ["JWT_SECRET_KEY"] = "super-secret-test-jwt-key-minimum-32-chars-long"
os.environ["CLOUDINARY_CLOUD_NAME"] = "test-cloud"
os.environ["CLOUDINARY_API_KEY"] = "123456789"
os.environ["CLOUDINARY_API_SECRET"] = "test-secret"
os.environ["GROQ_API_KEY"] = "test-groq-key"
os.environ["TAVILY_API_KEY"] = "test-tavily-key"

from backend.main import app
from backend.models.db import Base, User, post, Comment, Like, Follow, SavedPost, get_async_session, get_user_db
from backend.core.users import get_jwt_strategy, UserManager

# Engine for tests
test_engine = create_async_engine(
    f"sqlite+aiosqlite:///{test_db_file}",
    connect_args={"check_same_thread": False},
)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False)

@pytest_asyncio.fixture(scope="session", autouse=True)
async def init_test_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()
    try:
        import shutil
        shutil.rmtree(test_db_dir, ignore_errors=True)
    except Exception:
        pass

@pytest_asyncio.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session

@pytest_asyncio.fixture(autouse=True)
async def override_dependencies(db_session, monkeypatch, tmp_path):
    async def _get_test_session():
        yield db_session

    async def _get_test_user_db():
        yield SQLAlchemyUserDatabase(db_session, User)

    app.dependency_overrides[get_async_session] = _get_test_session
    app.dependency_overrides[get_user_db] = _get_test_user_db

    # Ensure avatar upload in backend.api.users never touches real uploads/ directory
    temp_avatars = tmp_path / "avatars"
    temp_avatars.mkdir(parents=True, exist_ok=True)
    
    # Patch os.makedirs and upload path logic in users router if called
    real_makedirs = os.makedirs
    def safe_makedirs(path, *args, **kwargs):
        if "uploads" in str(path):
            real_makedirs(temp_avatars, exist_ok=True)
        else:
            real_makedirs(path, *args, **kwargs)
    monkeypatch.setattr(os, "makedirs", safe_makedirs)

    yield

    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())

@pytest_asyncio.fixture
async def client(db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as ac:
        yield ac

@pytest_asyncio.fixture
async def test_user(db_session):
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email="testuser@example.com",
        name="Test User",
        hashed_password="hashed_test_password",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        bio="Test user bio"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user

@pytest_asyncio.fixture
async def test_user_2(db_session):
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email="otheruser@example.com",
        name="Other User",
        hashed_password="hashed_other_password",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        bio="Other user bio"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user

@pytest_asyncio.fixture
async def auth_headers(test_user):
    strategy = get_jwt_strategy()
    token = await strategy.write_token(test_user)
    return {"Authorization": f"Bearer {token}"}

@pytest_asyncio.fixture
async def auth_headers_2(test_user_2):
    strategy = get_jwt_strategy()
    token = await strategy.write_token(test_user_2)
    return {"Authorization": f"Bearer {token}"}

@pytest_asyncio.fixture
async def sample_post(db_session, test_user):
    post_id = uuid.uuid4()
    p = post(
        id=post_id,
        caption="Sample test post caption",
        url="https://res.cloudinary.com/test/image/upload/sample.jpg",
        file_type="image/jpeg",
        file_name="sample_public_id",
        user_id=test_user.id
    )
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p

@pytest_asyncio.fixture
async def sample_comment(db_session, test_user, sample_post):
    comment_id = uuid.uuid4()
    c = Comment(
        id=comment_id,
        text="A sample test comment",
        user_id=test_user.id,
        post_id=sample_post.id
    )
    db_session.add(c)
    await db_session.commit()
    await db_session.refresh(c)
    return c
