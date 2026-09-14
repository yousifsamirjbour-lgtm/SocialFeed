import uuid
from typing import List
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import post, Comment, Follow, User, get_async_session
from backend.models.schemas import CommentCreate, CommentResponse
from backend.core.users import current_active_user

router = APIRouter(tags=["Comments"])

@router.post("/posts/{post_id}/comments", response_model=CommentResponse)
async def create_comment(
    post_id: uuid.UUID,
    comment_data: CommentCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    post_query = select(post).where(post.id == post_id)
    target_post = (await session.execute(post_query)).scalar_one_or_none()
    
    if not target_post:
        raise HTTPException(status_code=404, detail="Post not found")
        
    new_comment = Comment(
        text=comment_data.text,
        user_id=user.id,
        post_id=post_id
    )
    session.add(new_comment)
    await session.commit()
    
    await session.refresh(new_comment) 
    new_comment.author = user
    
    return new_comment

@router.get("/posts/{post_id}/comments", response_model=List[CommentResponse])
async def get_comments(
    post_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    post_query = select(post).where(post.id == post_id)
    target_post = (await session.execute(post_query)).scalar_one_or_none()
    
    if not target_post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    followed_query = select(Follow.followed_id).where(Follow.follower_id == user.id)
    followed_ids = (await session.execute(followed_query)).scalars().all()

    comments_query = select(Comment).where(Comment.post_id == post_id).options(
        joinedload(Comment.author)
    ).order_by(Comment.created_at.desc())

    result = await session.execute(comments_query)
    comments = result.scalars().all()
    
    for comment in comments:
        comment.author.is_following = comment.author.id in followed_ids
        
    return comments

@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    query = select(Comment).where(Comment.id == comment_id).options(
        joinedload(Comment.post_parent)
    )
    target_comment = (await session.execute(query)).scalar_one_or_none()
    
    if not target_comment:
        raise HTTPException(status_code=404, detail="Comment not found")
        
    is_comment_author = (target_comment.user_id == user.id)
    is_post_owner = (target_comment.post_parent.user_id == user.id) 

    if not (is_comment_author or is_post_owner):
        raise HTTPException(
            status_code=403, 
            detail="You must be the comment author or the post owner to delete this."
        )
        
    await session.delete(target_comment)
    await session.commit()
    
    return None