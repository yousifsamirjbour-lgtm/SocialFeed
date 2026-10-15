import uuid
import logging
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, or_
from backend.models.db import DocumentChunk

logger = logging.getLogger(__name__)

class PostgresDocumentRetriever:
    """
    Retriever for user-uploaded document chunks within a chat session.
    Supports PostgreSQL full-text search (with 'simple' configuration for
    bilingual English & Arabic text) and SQLite fallback for tests.
    """

    async def retrieve_fts(
        self,
        query: str,
        session: AsyncSession,
        user_id: Any,
        chat_session_id: Any,
        limit: int = 8
    ) -> List[Dict[str, Any]]:
        """
        Performs full-text search across DocumentChunks filtered by user_id and chat_session_id.
        """
        results: List[Dict[str, Any]] = []
        cleaned_query = query.strip()
        if not cleaned_query:
            return results

        try:
            user_uuid = uuid.UUID(str(user_id)) if not isinstance(user_id, uuid.UUID) else user_id
            session_uuid = uuid.UUID(str(chat_session_id)) if not isinstance(chat_session_id, uuid.UUID) else chat_session_id
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid UUID for user_id or chat_session_id: {e}")
            return results

        bind = session.bind
        dialect_name = bind.dialect.name if bind else "postgresql"

        if dialect_name == "postgresql":
            # PostgreSQL full-text search with 'simple' tsvector/tsquery
            # Using 'simple' avoids English-specific stemming stripping Arabic characters or suffixes
            fts_stmt = (
                select(
                    DocumentChunk,
                    func.ts_rank_cd(
                        func.to_tsvector("simple", DocumentChunk.content),
                        func.websearch_to_tsquery("simple", cleaned_query)
                    ).label("rank")
                )
                .where(
                    DocumentChunk.user_id == user_uuid,
                    DocumentChunk.chat_session_id == session_uuid,
                    func.to_tsvector("simple", DocumentChunk.content).op("@@")(
                        func.websearch_to_tsquery("simple", cleaned_query)
                    )
                )
                .order_by(text("rank DESC"))
                .limit(limit)
            )

            try:
                res = await session.execute(fts_stmt)
                rows = res.all()
                for chunk, rank in rows:
                    results.append({
                        "id": str(chunk.id),
                        "filename": chunk.filename,
                        "page_number": chunk.page_number,
                        "chunk_index": chunk.chunk_index,
                        "content": chunk.content,
                        "score": float(rank) if rank is not None else 0.0,
                        "source_type": "document"
                    })
            except Exception as e:
                logger.error(f"PostgreSQL FTS retrieval error: {e}")
                # Fallback to simple ILIKE search in case websearch_to_tsquery encounters an unparsed token
                results = await self._retrieve_sqlite_fallback(
                    cleaned_query, session, user_uuid, session_uuid, limit
                )
        else:
            # SQLite fallback for local / testing environments
            results = await self._retrieve_sqlite_fallback(
                cleaned_query, session, user_uuid, session_uuid, limit
            )

        return results

    async def _retrieve_sqlite_fallback(
        self,
        query: str,
        session: AsyncSession,
        user_uuid: uuid.UUID,
        session_uuid: uuid.UUID,
        limit: int
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        words = [w for w in query.split() if len(w) > 1][:6]
        clauses = [DocumentChunk.content.ilike(f"%{w}%") for w in words] if words else [DocumentChunk.content.isnot(None)]

        fallback_stmt = (
            select(DocumentChunk)
            .where(
                DocumentChunk.user_id == user_uuid,
                DocumentChunk.chat_session_id == session_uuid,
                or_(*clauses)
            )
            .limit(limit)
        )

        res = await session.execute(fallback_stmt)
        chunks = res.scalars().all()
        for idx, chunk in enumerate(chunks):
            results.append({
                "id": str(chunk.id),
                "filename": chunk.filename,
                "page_number": chunk.page_number,
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
                "score": 1.0 / (idx + 1),
                "source_type": "document"
            })
        return results

    async def retrieve(
        self,
        query: str,
        session: AsyncSession,
        user_id: Any,
        chat_session_id: Any,
        limit: int = 8
    ) -> List[Dict[str, Any]]:
        """
        Unified retrieval entry point.
        In Phase 1, delegates to retrieve_fts.
        In Phase 2, can blend FTS with vector search.
        """
        return await self.retrieve_fts(
            query=query,
            session=session,
            user_id=user_id,
            chat_session_id=chat_session_id,
            limit=limit
        )
