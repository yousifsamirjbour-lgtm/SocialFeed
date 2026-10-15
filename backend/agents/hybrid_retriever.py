import os
import uuid
import logging
import asyncio
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, or_
from backend.models.db import DocumentChunk

logger = logging.getLogger(__name__)

def get_embeddings_model():
    """Returns Google Generative AI embeddings model if GOOGLE_API_KEY is configured."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None
    try:
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        return GoogleGenerativeAIEmbeddings(
            model="models/text-embedding-004",
            google_api_key=api_key
        )
    except Exception as e:
        logger.warning(f"Could not initialize Google embeddings: {e}")
        return None

def reciprocal_rank_fusion(
    fts_results: List[Dict[str, Any]],
    vector_results: List[Dict[str, Any]],
    k: int = 60,
    top_n: int = 8
) -> List[Dict[str, Any]]:
    """
    Combines Full-Text Search and Dense Semantic Vector results using
    Reciprocal Rank Fusion: RRF(d) = sum( 1 / (k + rank) ).
    """
    scores: Dict[str, float] = {}
    chunk_map: Dict[str, Dict[str, Any]] = {}

    for rank, item in enumerate(fts_results):
        cid = item["id"]
        scores[cid] = scores.get(cid, 0.0) + (1.0 / (k + rank + 1))
        chunk_map[cid] = item

    for rank, item in enumerate(vector_results):
        cid = item["id"]
        scores[cid] = scores.get(cid, 0.0) + (1.0 / (k + rank + 1))
        if cid not in chunk_map:
            chunk_map[cid] = item

    sorted_ids = sorted(scores.keys(), key=lambda cid: scores[cid], reverse=True)
    fused: List[Dict[str, Any]] = []

    for cid in sorted_ids[:top_n]:
        res = dict(chunk_map[cid])
        res["score"] = scores[cid]
        res["source_type"] = "document"
        fused.append(res)

    return fused

class PostgresDocumentRetriever:
    """
    Hybrid retriever for user-uploaded document chunks within a chat session.
    Combines PostgreSQL full-text search (simple text search dictionary) with
    dense semantic vector similarity (pgvector text-embedding-004) fused via RRF.
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
                results = await self._retrieve_sqlite_fallback(
                    cleaned_query, session, user_uuid, session_uuid, limit
                )
        else:
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

    async def retrieve_vector(
        self,
        query: str,
        session: AsyncSession,
        user_id: Any,
        chat_session_id: Any,
        limit: int = 8
    ) -> List[Dict[str, Any]]:
        """
        Performs semantic vector search using Google embeddings text-embedding-004
        and pgvector cosine distance.
        """
        results: List[Dict[str, Any]] = []
        cleaned_query = query.strip()
        if not cleaned_query:
            return results

        bind = session.bind
        dialect_name = bind.dialect.name if bind else "postgresql"
        if dialect_name != "postgresql":
            # pgvector cosine distance is PostgreSQL-specific
            return results

        embedder = get_embeddings_model()
        if not embedder:
            return results

        try:
            user_uuid = uuid.UUID(str(user_id)) if not isinstance(user_id, uuid.UUID) else user_id
            session_uuid = uuid.UUID(str(chat_session_id)) if not isinstance(chat_session_id, uuid.UUID) else chat_session_id
        except (ValueError, TypeError):
            return results

        try:
            query_vec = await embedder.aembed_query(cleaned_query)
            vec_stmt = (
                select(
                    DocumentChunk,
                    DocumentChunk.embedding.cosine_distance(query_vec).label("distance")
                )
                .where(
                    DocumentChunk.user_id == user_uuid,
                    DocumentChunk.chat_session_id == session_uuid,
                    DocumentChunk.embedding.isnot(None)
                )
                .order_by(text("distance ASC"))
                .limit(limit)
            )

            res = await session.execute(vec_stmt)
            rows = res.all()
            for chunk, dist in rows:
                similarity = 1.0 - float(dist) if dist is not None else 0.0
                results.append({
                    "id": str(chunk.id),
                    "filename": chunk.filename,
                    "page_number": chunk.page_number,
                    "chunk_index": chunk.chunk_index,
                    "content": chunk.content,
                    "score": max(0.0, similarity),
                    "source_type": "document"
                })
        except Exception as e:
            logger.warning(f"Vector retrieval exception (pgvector/embedding): {e}")

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
        Unified Hybrid RAG retrieval entry point.
        Executes FTS and Vector search concurrently and fuses them with Reciprocal Rank Fusion (RRF).
        Falls back seamlessly if vector search is unavailable or returns 0 results.
        """
        fts_task = self.retrieve_fts(query, session, user_id, chat_session_id, limit=limit)
        vec_task = self.retrieve_vector(query, session, user_id, chat_session_id, limit=limit)

        fts_results, vec_results = await asyncio.gather(fts_task, vec_task, return_exceptions=True)

        fts_clean = fts_results if isinstance(fts_results, list) else []
        vec_clean = vec_results if isinstance(vec_results, list) else []

        if not vec_clean:
            return fts_clean[:limit]
        if not fts_clean:
            return vec_clean[:limit]

        return reciprocal_rank_fusion(fts_clean, vec_clean, k=60, top_n=limit)
