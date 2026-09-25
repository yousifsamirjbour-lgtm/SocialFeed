import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.types import Uuid
from fastapi import Depends
from fastapi_users_db_sqlalchemy.generics import GUID
from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
import os
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
class Base(DeclarativeBase):
    pass

class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "users"  # Changed from "user" to avoid PostgreSQL reserved keyword crash
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    posts = relationship("post", back_populates="owner") # Reverted to lowercase "post"
    comments = relationship("Comment", back_populates="author", cascade="all, delete-orphan")
    bio = Column(String, nullable=True)
    profile_picture_url = Column(String, nullable=True)

class Like(Base):
    __tablename__ = "likes"
    
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    post_id = Column(Uuid, ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Follow(Base):
    __tablename__ = "follows"
    
    follower_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    followed_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)) 

class post(Base): 
    __tablename__ = "posts"  

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    caption = Column(Text)
    url = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
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

class SavedPost(Base):
    __tablename__ = "saved_posts"
    
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    post_id = Column(Uuid, ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

# Added connection pooling optimizations for PostgreSQL
engine = create_async_engine(DATABASE_URL, echo=True, pool_size=10, max_overflow=20)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)

async def create_db_and_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session

async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    yield SQLAlchemyUserDatabase(session, User)