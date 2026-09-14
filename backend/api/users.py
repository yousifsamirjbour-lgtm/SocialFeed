import os
import uuid
import shutil
from typing import List
from fastapi import APIRouter, HTTPException, File, UploadFile, Form, Depends
from sqlalchemy import select, func
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import User, Follow, Like, SavedPost, post, get_async_session
from backend.models.schemas import (
    UserRead,
    UserProfileResponse,
    UserFeedInfo,
    ProfileUpdateResponse,
    postresponse
)
from backend.core.users import current_active_user
from backend.core.services import fetch_decorated_posts

router = APIRouter(tags=["Users"])

@router.post("/users/{target_user_id}/follow")
async def toggle_follow(
    target_user_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    if target_user_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot follow yourself.")
        
    target_user_query = select(User).where(User.id == target_user_id)
    target_user_result = await session.execute(target_user_query)
    target_user = target_user_result.scalar_one_or_none()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    follow_query = select(Follow).where(
        Follow.follower_id == user.id, 
        Follow.followed_id == target_user_id
    )
    follow_result = await session.execute(follow_query)
    existing_follow = follow_result.scalar_one_or_none()
    
    if existing_follow:
        await session.delete(existing_follow)
        await session.commit()
        return {"message": "User unfollowed", "is_following": False}
    else:
        new_follow = Follow(follower_id=user.id, followed_id=target_user_id)
        session.add(new_follow)
        await session.commit()
        return {"message": "User followed", "is_following": True}

@router.get("/users/me/saved", response_model=List[postresponse])
async def get_saved_posts(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    base_query = (
        select(post)
        .join(SavedPost, SavedPost.post_id == post.id)
        .where(SavedPost.user_id == user.id)
        .order_by(SavedPost.created_at.desc())
    )
    return await fetch_decorated_posts(session, user.id, base_query)

@router.get("/users/me/liked", response_model=List[postresponse])
async def get_liked_posts(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    base_query = (
        select(post)
        .join(Like, Like.post_id == post.id)
        .where(Like.user_id == user.id)
        .order_by(Like.created_at.desc())
    )
    return await fetch_decorated_posts(session, user.id, base_query)

@router.get("/users/me/liked-posts", response_model=List[postresponse])
async def get_liked_posts_alias(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    UserLike = aliased(Like)
    base_query = (
        select(post)
        .join(UserLike, UserLike.post_id == post.id)
        .where(UserLike.user_id == user.id)
        .order_by(UserLike.created_at.desc())
    )
    return await fetch_decorated_posts(session, user.id, base_query)

@router.get("/users", response_model=List[UserRead])
async def get_all_users(
    session: AsyncSession = Depends(get_async_session)
):
    followers_sq = (
        select(func.count(Follow.follower_id))
        .where(Follow.followed_id == User.id)
        .scalar_subquery()
    )
    following_sq = (
        select(func.count(Follow.followed_id))
        .where(Follow.follower_id == User.id)
        .scalar_subquery()
    )

    query = select(
        User,
        followers_sq.label("followers_count"),
        following_sq.label("following_count")
    )

    result = await session.execute(query)
    rows = result.all()

    final_users = []
    for user_obj, followers_c, following_c in rows:
        user_obj.followers_count = followers_c
        user_obj.following_count = following_c
        final_users.append(user_obj)

    return final_users

@router.get("/users/{target_user_id}/profile", response_model=UserProfileResponse)
async def get_user_profile(
    target_user_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    query = select(User).where(User.id == target_user_id)
    profile_user = (await session.execute(query)).scalar_one_or_none()
    
    if not profile_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    followers_query = select(func.count()).where(Follow.followed_id == target_user_id)
    followers_count = (await session.execute(followers_query)).scalar()
    
    following_query = select(func.count()).where(Follow.follower_id == target_user_id)
    following_count = (await session.execute(following_query)).scalar()
    
    follow_check_query = select(Follow).where(
        Follow.follower_id == user.id,
        Follow.followed_id == target_user_id
    )
    is_following_target = (await session.execute(follow_check_query)).scalar_one_or_none() is not None
    
    post_query = select(post).where(post.user_id == target_user_id).order_by(post.created_at.desc())
    decorated_posts = await fetch_decorated_posts(session, user.id, post_query)
    
    return {
        **profile_user.__dict__, 
        "followers_count": followers_count,
        "following_count": following_count,
        "is_following": is_following_target,
        "posts": decorated_posts
    }

@router.get("/users/search", response_model=List[UserFeedInfo])
async def search_users(
    q: str,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    if not q.strip():
        return []
        
    search_query = f"%{q}%"
    query = select(User).where(User.email.ilike(search_query)).limit(20)
    
    result = await session.execute(query)
    users = result.scalars().all()
    
    followed_query = select(Follow.followed_id).where(Follow.follower_id == user.id)
    followed_ids = (await session.execute(followed_query)).scalars().all()
    
    for u in users:
        u.is_following = u.id in followed_ids
        
    return users

@router.get("/posts/{post_id}/likes", response_model=List[UserFeedInfo])
async def get_post_likers(
    post_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    post_query = select(post).where(post.id == post_id)
    target_post = (await session.execute(post_query)).scalar_one_or_none()
    
    if not target_post:
        raise HTTPException(status_code=404, detail="Post not found")

    query = (
        select(User)
        .join(Like, User.id == Like.user_id)
        .where(Like.post_id == post_id)
    )
    
    result = await session.execute(query)
    likers = result.scalars().all()

    followed_query = select(Follow.followed_id).where(Follow.follower_id == user.id)
    followed_ids = (await session.execute(followed_query)).scalars().all()
    
    for liker in likers:
        liker.is_following = liker.id in followed_ids
    
    return likers

@router.get("/users/{user_id}/followers", response_model=List[UserFeedInfo])
async def get_followers(
    user_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    follow_query = select(Follow.follower_id).where(Follow.followed_id == user_id)
    follower_ids = (await session.execute(follow_query)).scalars().all()

    if not follower_ids:
        return []

    user_query = select(User).where(User.id.in_(follower_ids))
    followers = (await session.execute(user_query)).scalars().all()

    followed_query = select(Follow.followed_id).where(Follow.follower_id == user.id)
    followed_ids = (await session.execute(followed_query)).scalars().all()

    for f in followers:
        f.is_following = f.id in followed_ids

    return followers

@router.get("/users/{user_id}/following", response_model=List[UserFeedInfo])
async def get_following(
    user_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    follow_query = select(Follow.followed_id).where(Follow.follower_id == user_id)
    following_ids = (await session.execute(follow_query)).scalars().all()

    if not following_ids:
        return []

    user_query = select(User).where(User.id.in_(following_ids))
    following = (await session.execute(user_query)).scalars().all()

    followed_query = select(Follow.followed_id).where(Follow.follower_id == user.id)
    followed_ids = (await session.execute(followed_query)).scalars().all()

    for f in following:
        f.is_following = f.id in followed_ids

    return following

@router.patch("/users/me/profile", response_model=ProfileUpdateResponse)
async def update_profile(
    bio: str = Form(None), 
    file: UploadFile = File(None),
    remove_photo: str = Form("false"),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    query = select(User).where(User.id == user.id)
    db_user = (await session.execute(query)).scalar_one_or_none()
    
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if bio is not None:
        db_user.bio = bio

    if remove_photo == "true":
        db_user.profile_picture_url = None

    if file:
        os.makedirs("uploads/avatars", exist_ok=True)
        file_extension = file.filename.split(".")[-1]
        file_name = f"{uuid.uuid4()}.{file_extension}"
        file_path = f"uploads/avatars/{file_name}"
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        db_user.profile_picture_url = f"/{file_path}"

    await session.commit()
    await session.refresh(db_user)
    
    return ProfileUpdateResponse(
        message="Profile updated successfully",
        bio=db_user.bio,
        profile_picture_url=db_user.profile_picture_url
    )