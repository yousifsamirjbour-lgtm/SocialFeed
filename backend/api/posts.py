import io
import os
import uuid
from typing import List, Optional
from fastapi import APIRouter, HTTPException, File, UploadFile, Form, Depends, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import post, User, Like, Follow, SavedPost, get_async_session
from backend.models.schemas import postresponse
from backend.core.users import current_active_user
from backend.core.images import uploader
from backend.core.services import fetch_decorated_posts

router = APIRouter(tags=["Posts"])

MAX_FILE_SIZE_MB = 100
MAX_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime"
}

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    caption: Optional[str] = Form(""),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported file type.")

    file_bytes = await file.read()
    print(f"--- DEBUG: FILE SIZE IS {len(file_bytes)} BYTES ---")
    
    if len(file_bytes) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large.")
    
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="The file is corrupted or 0 bytes.")

    resource_type = "video" if file.content_type and file.content_type.startswith("video/") else "image"

    result = await run_in_threadpool(
        uploader.upload,        
        io.BytesIO(file_bytes),            
        folder="app_uploads",
        resource_type=resource_type,
        eager=[{"format": "mp4", "video_codec": "auto", "width": 1280, "crop": "limit"}],
        eager_async=True 
    )

    new_post = post(
        caption=caption,
        url=result.get("secure_url"),
        file_type=file.content_type,
        file_name=result.get("public_id"),
        user_id=user.id 
    )
    
    session.add(new_post)
    await session.commit()
    await session.refresh(new_post)
    
    return {"message": "Upload successful", "post_id": new_post.id}

@router.post("/posts/{post_id}/like")
async def toggle_like(
    post_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    post_query = select(post).where(post.id == post_id)
    post_result = await session.execute(post_query)
    target_post = post_result.scalar_one_or_none()
    
    if not target_post:
        raise HTTPException(status_code=404, detail="Post not found.")
        
    like_query = select(Like).where(Like.user_id == user.id, Like.post_id == post_id)
    like_result = await session.execute(like_query)
    existing_like = like_result.scalar_one_or_none()
    
    if existing_like:
        await session.delete(existing_like)
        await session.commit()
        return {"message": "Post unliked", "liked": False}
    else:
        new_like = Like(user_id=user.id, post_id=post_id)
        session.add(new_like)
        await session.commit()
        return {"message": "Post liked", "liked": True}

@router.post("/posts/{post_id}/save")
async def toggle_save(
    post_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    post_query = select(post).where(post.id == post_id)
    target_post = (await session.execute(post_query)).scalar_one_or_none()
    if not target_post:
        raise HTTPException(status_code=404, detail="Post not found.")
        
    save_query = select(SavedPost).where(SavedPost.user_id == user.id, SavedPost.post_id == post_id)
    existing_save = (await session.execute(save_query)).scalar_one_or_none()
    
    if existing_save:
        await session.delete(existing_save)
        await session.commit()
        return {"message": "Post unsaved", "is_saved": False}
    else:
        new_save = SavedPost(user_id=user.id, post_id=post_id)
        session.add(new_save)
        await session.commit()
        return {"message": "Post saved", "is_saved": True}

@router.get("/feed", response_model=List[postresponse])
async def get_feed(
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    following_only: bool = Query(False, description="Set to true to see only followed users"),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    base_query = select(post)
    
    if following_only:
        followed_query = select(Follow.followed_id).where(Follow.follower_id == user.id)
        followed_ids = (await session.execute(followed_query)).scalars().all()
        if not followed_ids:
            return []
        base_query = base_query.where(post.user_id.in_(followed_ids))
        
    base_query = base_query.order_by(post.created_at.desc()).limit(limit).offset(offset)
    
    return await fetch_decorated_posts(session, user.id, base_query)

@router.delete("/posts/{post_id}")
async def delete_post(
    post_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    query = select(post).where(post.id == post_id)
    result = await session.execute(query)
    target_post = result.scalar_one_or_none()
    
    if not target_post:
        raise HTTPException(status_code=404, detail="Post not found.")
        
    if target_post.user_id != user.id:
        raise HTTPException(
            status_code=403, 
            detail="Forbidden: You do not have permission to delete this post."
        )
        
    await session.delete(target_post)
    await session.commit()
    
    return {"message": "Post successfully deleted."}