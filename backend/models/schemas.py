import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator
from fastapi_users import schemas
from typing import List, Optional

class UserRead(schemas.BaseUser[uuid.UUID]):
    name: str
    followers_count: int = 0
    following_count: int = 0
    bio: Optional[str] = None
    profile_picture_url: Optional[str] = None

class UserCreate(schemas.BaseUserCreate):
    name: str = Field(..., min_length=2, max_length=50)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not isinstance(v, str):
            raise ValueError("Name must be a string")
        cleaned = v.strip()
        if len(cleaned) < 2 or len(cleaned) > 50:
            raise ValueError("Name must be between 2 and 50 characters")
        return cleaned

class UserUpdate(schemas.BaseUserUpdate):
    name: Optional[str] = Field(None, min_length=2, max_length=50)

class UserFeedInfo(BaseModel):
    id: uuid.UUID
    name: str
    profile_picture_url: Optional[str] = None
    is_following: bool = False

    model_config = ConfigDict(from_attributes=True)

class postresponse(BaseModel):
    id: uuid.UUID
    caption: str
    url: str
    file_type: str
    file_name: str
    created_at: datetime
    user_id: uuid.UUID  
    likes_count: int = 0
    comment_count: int = 0
    is_liked: bool = False
    is_saved: Optional[bool] = False
    owner: UserFeedInfo 

    model_config = ConfigDict(from_attributes=True)

class UserProfileResponse(BaseModel):
    id: uuid.UUID
    name: str
    followers_count: int = 0
    following_count: int = 0
    is_following: bool = False
    bio: str | None = None
    profile_picture_url: str | None = None
    posts: List[postresponse] = []

    model_config = ConfigDict(from_attributes=True)

class CommentCreate(BaseModel):
    text: str

class CommentResponse(BaseModel):
    id: uuid.UUID
    text: str
    created_at: datetime
    user_id: uuid.UUID
    post_id: uuid.UUID
    author: UserFeedInfo 
    likes_count: int = 0
    is_liked: bool = False

    model_config = ConfigDict(from_attributes=True)

class ProfileUpdateResponse(BaseModel):
    message: str
    bio: str | None = None
    profile_picture_url: str | None = None

    model_config = ConfigDict(from_attributes=True)

class NotificationActorInfo(BaseModel):
    id: uuid.UUID
    name: str
    profile_picture_url: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class NotificationResponse(BaseModel):
    id: uuid.UUID
    type: str
    actor: NotificationActorInfo
    actors_count: int = 1
    post_id: Optional[uuid.UUID] = None
    comment_id: Optional[uuid.UUID] = None
    post_url: Optional[str] = None
    post_file_type: Optional[str] = None
    comment_text: Optional[str] = None
    is_read: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class NotificationsListResponse(BaseModel):
    notifications: List[NotificationResponse]
    unread_count: int

class StreamTicketResponse(BaseModel):
    ticket: str
    expires_in: int = 30