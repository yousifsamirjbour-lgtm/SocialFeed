import uuid
from datetime import datetime
from pydantic import BaseModel
from fastapi_users import schemas
from typing import List, Optional

class UserRead(schemas.BaseUser[uuid.UUID]):
    followers_count: int = 0
    following_count: int = 0

class UserCreate(schemas.BaseUserCreate):
    pass

class UserUpdate(schemas.BaseUserUpdate):
    pass

class UserFeedInfo(BaseModel):
    id: uuid.UUID
    email: str
    is_following: bool = False
    class Config:
        from_attributes = True

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

    class Config:
        from_attributes = True

class UserProfileResponse(BaseModel):
    id: uuid.UUID
    email: str
    followers_count: int = 0
    following_count: int = 0
    is_following: bool = False
    bio: str | None = None
    profile_picture_url: str | None = None
    posts: List[postresponse] = []

    class Config:
        from_attributes = True

class CommentCreate(BaseModel):
    text: str

class CommentResponse(BaseModel):
    id: uuid.UUID
    text: str
    created_at: datetime
    user_id: uuid.UUID
    post_id: uuid.UUID
    author: UserFeedInfo 

    class Config:
        from_attributes = True

class ProfileUpdateResponse(BaseModel):
    message: str
    bio: str | None = None
    profile_picture_url: str | None = None

    class Config:
        from_attributes = True