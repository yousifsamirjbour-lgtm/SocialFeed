import uuid
from typing import List
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import post, Comment, Like, Follow

async def fetch_decorated_posts(session: AsyncSession, current_user_id: uuid.UUID, base_query):
    comments_count = select(func.count(Comment.id)).where(Comment.post_id == post.id).correlate(post).scalar_subquery()
    likes_count = select(func.count(Like.user_id)).where(Like.post_id == post.id).correlate(post).scalar_subquery()
    
    query = base_query.add_columns(
        comments_count.label("comment_count"), 
        likes_count.label("like_count")
    ).options(
        selectinload(post.likes),
        selectinload(post.comments),
        selectinload(post.owner),
        selectinload(post.saves) 
    )
    
    rows = (await session.execute(query)).all()
    
    followed_query = select(Follow.followed_id).where(Follow.follower_id == current_user_id)
    followed_ids = (await session.execute(followed_query)).scalars().all()
    
    final_posts = []
    for p, c_count, l_count in rows:
        p.comment_count = c_count
        p.like_count = l_count
        p.is_liked = any(like.user_id == current_user_id for like in p.likes)
        p.is_saved = any(save.user_id == current_user_id for save in p.saves)
        p.owner.is_following = p.user_id in followed_ids
        final_posts.append(p)
        
    return final_posts