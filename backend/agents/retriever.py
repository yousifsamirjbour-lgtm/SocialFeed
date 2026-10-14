import uuid
from typing import Protocol, List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, text
from sqlalchemy.orm import selectinload
from backend.models.db import post, Comment, User

class InternalRetriever(Protocol):
    """Interface for retrieving internal SocialFeed content."""
    async def retrieve(
        self,
        query: str,
        session: AsyncSession,
        post_id: Optional[str] = None,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        ...

class PostgresInternalRetriever:
    """Full-text search retriever over SocialFeed posts and comments with SQLite fallback."""

    async def retrieve(
        self,
        query: str,
        session: AsyncSession,
        post_id: Optional[str] = None,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        bind = session.bind
        dialect_name = bind.dialect.name if bind else "postgresql"

        # 1. If an explicit post_id is provided, prioritize retrieving it with its full discussion thread
        if post_id:
            try:
                target_uuid = uuid.UUID(str(post_id))
                stmt = (
                    select(post)
                    .options(
                        selectinload(post.owner),
                        selectinload(post.comments).selectinload(Comment.author)
                    )
                    .where(post.id == target_uuid)
                )
                res = await session.execute(stmt)
                target_post = res.scalar_one_or_none()
                if target_post:
                    results.append(self._format_post(target_post, is_target=True))
            except (ValueError, TypeError):
                pass

        # 2. Query posts matching the search query
        cleaned_query = query.strip()
        if not cleaned_query:
            return results

        words = [w for w in cleaned_query.split() if len(w) > 2][:5]

        if dialect_name == "postgresql":
            # PostgreSQL built-in full-text search
            fts_post_stmt = (
                select(post)
                .options(
                    selectinload(post.owner),
                    selectinload(post.comments).selectinload(Comment.author)
                )
                .where(
                    text("to_tsvector('english', coalesce(posts.caption, '')) @@ plainto_tsquery('english', :q)")
                )
                .params(q=cleaned_query)
                .limit(limit)
            )
            try:
                post_res = await session.execute(fts_post_stmt)
                matched_posts = post_res.scalars().all()
            except Exception:
                matched_posts = []
        else:
            # SQLite fallback for testing environments
            clauses = [post.caption.ilike(f"%{w}%") for w in words] if words else [post.caption.isnot(None)]
            fallback_stmt = (
                select(post)
                .options(
                    selectinload(post.owner),
                    selectinload(post.comments).selectinload(Comment.author)
                )
                .where(or_(*clauses))
                .limit(limit)
            )
            post_res = await session.execute(fallback_stmt)
            matched_posts = post_res.scalars().all()

        existing_ids = {r["id"] for r in results}
        for p in matched_posts:
            if str(p.id) not in existing_ids:
                results.append(self._format_post(p))
                existing_ids.add(str(p.id))
                if len(results) >= limit:
                    break

        return results

    def _format_post(self, p: post, is_target: bool = False) -> Dict[str, Any]:
        author_name = p.owner.name if p.owner and p.owner.name else "Anonymous"
        author_id = str(p.owner.id) if p.owner else ""
        comments_data = []
        if p.comments:
            for c in p.comments[:5]:
                c_author = c.author.name if c.author and c.author.name else "Anonymous"
                comments_data.append({
                    "author": c_author,
                    "text": c.text,
                    "created_at": c.created_at.isoformat() if c.created_at else None
                })

        return {
            "id": str(p.id),
            "author": author_name,
            "author_id": author_id,
            "caption": p.caption or "",
            "media_url": p.url,
            "is_target_post": is_target,
            "comments_count": len(p.comments) if p.comments else 0,
            "comments": comments_data,
            "created_at": p.created_at.isoformat() if p.created_at else None
        }
