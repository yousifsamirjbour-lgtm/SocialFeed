import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, date, timezone
from sqlalchemy import Column, String, Text, DateTime, Date, ForeignKey, Integer, JSON, Boolean, Index, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.types import Uuid
from pgvector.sqlalchemy import Vector
from fastapi import Depends
from fastapi_users_db_sqlalchemy.generics import GUID
from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path="backend/.env")
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:2003@localhost:5432/socialfeed")
class Base(DeclarativeBase):
    pass

class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "users"  # Changed from "user" to avoid PostgreSQL reserved keyword crash
    
    name = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    posts = relationship("post", back_populates="owner") # Reverted to lowercase "post"
    comments = relationship("Comment", back_populates="author", cascade="all, delete-orphan")
    bio = Column(String, nullable=True)
    profile_picture_url = Column(String, nullable=True)

class Like(Base):
    __tablename__ = "likes"
    
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    post_id = Column(Uuid, ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Follow(Base):
    __tablename__ = "follows"
    
    follower_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    followed_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)) 

class post(Base): 
    __tablename__ = "posts"  

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    caption = Column(Text)
    url = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    owner = relationship("User", back_populates="posts")
    likes = relationship("Like", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="post_parent", cascade="all, delete-orphan")
    saves = relationship("SavedPost", cascade="all, delete-orphan")
    
    @property
    def likes_count(self) -> int:
        return len(self.likes)

class Comment(Base):
    __tablename__ = "comments"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    text = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    post_id = Column(Uuid, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)
     
    author = relationship("User", foreign_keys=[user_id], back_populates="comments")
    post_parent = relationship("post", foreign_keys=[post_id], back_populates="comments") # Reverted to lowercase "post"
    likes = relationship("CommentLike", cascade="all, delete-orphan", back_populates="comment")

    @property
    def likes_count(self) -> int:
        if hasattr(self, "_likes_count"):
            return self._likes_count
        return len(self.likes) if self.likes else 0

    @likes_count.setter
    def likes_count(self, val: int):
        self._likes_count = val

class CommentLike(Base):
    __tablename__ = "comment_likes"
    
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    comment_id = Column(Uuid, ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User")
    comment = relationship("Comment", back_populates="likes")

class SavedPost(Base):
    __tablename__ = "saved_posts"
    
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    post_id = Column(Uuid, ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    recipient_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(32), nullable=False)  # 'comment', 'post_like', 'post_save', 'comment_like'
    post_id = Column(Uuid, ForeignKey("posts.id", ondelete="CASCADE"), nullable=True, index=True)
    comment_id = Column(Uuid, ForeignKey("comments.id", ondelete="CASCADE"), nullable=True, index=True)
    is_read = Column(Boolean, default=False, nullable=False, index=True)
    extra_data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    recipient = relationship("User", foreign_keys=[recipient_id])
    actor = relationship("User", foreign_keys=[actor_id])
    post = relationship("post", foreign_keys=[post_id])
    comment = relationship("Comment", foreign_keys=[comment_id])



class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    chat_session_id = Column(Uuid, nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    page_number = Column(Integer, nullable=True)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(768), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", foreign_keys=[user_id])

class VoiceDailyQuota(Base):
    __tablename__ = "voice_daily_quotas"

    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    usage_date = Column(Date, primary_key=True, default=date.today, nullable=False)
    seconds_used = Column(Integer, default=0, nullable=False)
    turns_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", foreign_keys=[user_id])


# Connection arguments & pooling optimizations for PostgreSQL & Supabase
engine_connect_args = {}
if "asyncpg" in DATABASE_URL:
    # Disable asyncpg prepared statement cache for compatibility with Supabase's Transaction Pooler (port 6543 / pgBouncer)
    engine_connect_args["statement_cache_size"] = 0

engine = create_async_engine(
    DATABASE_URL,
    echo=True,
    pool_size=10,
    max_overflow=20,
    connect_args=engine_connect_args
)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)

async def create_db_and_tables():
    async with engine.begin() as conn:
        if "postgresql" in engine.url.drivername:
            res = await conn.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'"))
            has_vector = res.scalar() is not None
            if not has_vector:
                # Local environment without C pgvector extension installed:
                # Gracefully fallback column type to JSON so tables are created without crashing
                DocumentChunk.__table__.columns['embedding'].type = JSON()

        await conn.run_sync(Base.metadata.create_all)

async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session

async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    yield SQLAlchemyUserDatabase(session, User)