import os
import json
import uuid
import logging
from typing import List, Dict, Any, Optional, AsyncGenerator
from fastapi import APIRouter, HTTPException, Depends, status, File, UploadFile, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func

from backend.models.db import User, DocumentChunk, get_async_session
from backend.core.users import current_active_user
from backend.core.document_parser import (
    extract_text_from_document,
    chunk_document_pages,
    sanitize_filename,
    MAX_FILE_SIZE_BYTES,
    ALLOWED_EXTENSIONS
)
from backend.agents.chat_graph import chat_graph
from backend.agents.hybrid_retriever import get_embeddings_model

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat Agent"])

@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    chat_session_id: str = Form(...),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    Uploads and indexes a document (PDF, DOCX, TXT, MD) into DocumentChunk records
    for the current user and chat session.
    """
    try:
        session_uuid = uuid.UUID(chat_session_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chat_session_id UUID format."
        )

    # 1. Validate extension
    filename = file.filename or "uploaded_file"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file format '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # 2. Read bytes and check size
    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is empty."
        )
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB."
        )

    # 3. Parse and chunk
    try:
        pages = extract_text_from_document(file_bytes, filename)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error extracting text from document: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse document text."
        )

    chunks = chunk_document_pages(pages)
    if not chunks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not extract any meaningful text content from this document."
        )

    clean_name = sanitize_filename(filename)

    # 4. Generate dense embeddings if Google API is configured
    embedder = get_embeddings_model()
    embeddings_list = [None] * len(chunks)
    if embedder:
        try:
            texts = [c.get("content", "") for c in chunks]
            embeddings_list = await embedder.aembed_documents(texts)
        except Exception as e:
            logger.warning(f"Failed to generate chunk embeddings during upload: {e}")

    # 5. Save chunks to database
    chunk_records = []
    for idx, c in enumerate(chunks):
        chunk_records.append(
            DocumentChunk(
                user_id=user.id,
                chat_session_id=session_uuid,
                filename=clean_name,
                page_number=c.get("page_number"),
                chunk_index=c.get("chunk_index", 0),
                content=c.get("content", ""),
                embedding=embeddings_list[idx]
            )
        )

    session.add_all(chunk_records)
    await session.commit()

    return {
        "status": "success",
        "filename": clean_name,
        "chunk_count": len(chunk_records),
        "chat_session_id": str(session_uuid),
        "message": f"Successfully parsed and indexed {len(chunk_records)} chunks."
    }

@router.get("/attachments/{chat_session_id}")
async def get_session_attachments(
    chat_session_id: str,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    Returns the distinct uploaded files and chunk counts for a given chat session.
    """
    try:
        session_uuid = uuid.UUID(chat_session_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chat_session_id UUID format."
        )

    stmt = (
        select(
            DocumentChunk.filename,
            func.count(DocumentChunk.id).label("chunk_count"),
            func.min(DocumentChunk.created_at).label("uploaded_at")
        )
        .where(
            DocumentChunk.user_id == user.id,
            DocumentChunk.chat_session_id == session_uuid
        )
        .group_by(DocumentChunk.filename)
    )

    res = await session.execute(stmt)
    rows = res.all()

    attachments = [
        {
            "filename": row[0],
            "chunk_count": row[1],
            "uploaded_at": row[2].isoformat() if row[2] else None
        }
        for row in rows
    ]
    return attachments

@router.delete("/attachments/{chat_session_id}")
async def clear_session_attachments(
    chat_session_id: str,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    Deletes all uploaded document chunks for this chat session.
    """
    try:
        session_uuid = uuid.UUID(chat_session_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chat_session_id UUID format."
        )

    stmt = (
        delete(DocumentChunk)
        .where(
            DocumentChunk.user_id == user.id,
            DocumentChunk.chat_session_id == session_uuid
        )
    )
    res = await session.execute(stmt)
    await session.commit()

    return {
        "status": "success",
        "chat_session_id": str(session_uuid),
        "deleted_count": res.rowcount
    }

@router.delete("/attachments/{chat_session_id}/{filename}")
async def delete_single_attachment(
    chat_session_id: str,
    filename: str,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    Deletes all chunks belonging to a specific filename in this chat session.
    """
    try:
        session_uuid = uuid.UUID(chat_session_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chat_session_id UUID format."
        )

    stmt = (
        delete(DocumentChunk)
        .where(
            DocumentChunk.user_id == user.id,
            DocumentChunk.chat_session_id == session_uuid,
            DocumentChunk.filename == filename
        )
    )
    res = await session.execute(stmt)
    await session.commit()

    return {
        "status": "success",
        "filename": filename,
        "chat_session_id": str(session_uuid),
        "deleted_count": res.rowcount
    }

class ChatStreamRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    chat_session_id: str
    mode: str = Field("auto", pattern="^(auto|docs_only)$")

@router.post("/stream")
async def stream_chat(
    request: ChatStreamRequest,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    Initiates a streaming chat session with the LangGraph Hybrid RAG agent.
    Returns a Server-Sent Events (SSE) stream reporting intermediate agent steps
    and the finalized cited response.
    """
    try:
        session_uuid = uuid.UUID(request.chat_session_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chat_session_id UUID format."
        )

    config = {
        "configurable": {
            "thread_id": str(session_uuid),
            "session": session
        }
    }

    initial_state = {
        "messages": [],
        "query": request.query,
        "mode": request.mode,
        "user_id": str(user.id),
        "chat_session_id": str(session_uuid),
        "doc_count": 0,
        "retrieved_docs": [],
        "is_sufficient": False,
        "grade_reason": None,
        "web_docs": [],
        "sources_used": "None",
        "citations": [],
        "final_answer": ""
    }

    async def event_generator() -> AsyncGenerator[str, None]:
        def format_sse(event_name: str, data: dict) -> str:
            return f"event: {event_name}\ndata: {json.dumps(data)}\n\n"

        yield format_sse("step", {
            "name": "route_mode",
            "status": "Routing request and checking document attachments..."
        })

        try:
            last_state = dict(initial_state)
            async for update in chat_graph.astream(initial_state, config=config, stream_mode="updates"):
                for node_name, node_output in update.items():
                    if not isinstance(node_output, dict):
                        continue
                    last_state.update(node_output)

                    if node_name == "route_mode":
                        mode_label = "Documents Only" if node_output.get("mode") == "docs_only" else "Auto"
                        docs_found = node_output.get("doc_count", 0)
                        yield format_sse("step", {
                            "name": "route_mode",
                            "status": f"Mode: {mode_label} ({docs_found} attached chunk(s) found)"
                        })

                    elif node_name == "retrieve_docs":
                        docs = node_output.get("retrieved_docs", [])
                        yield format_sse("step", {
                            "name": "retrieve_docs",
                            "status": f"Found {len(docs)} matching excerpt(s) in attached documents."
                        })

                    elif node_name == "grade_relevance":
                        is_sufficient = node_output.get("is_sufficient", False)
                        reason = node_output.get("grade_reason", "")
                        if is_sufficient:
                            yield format_sse("step", {
                                "name": "grade_relevance",
                                "status": "Document evidence is comprehensive. Generating answer..."
                            })
                        else:
                            yield format_sse("step", {
                                "name": "grade_relevance",
                                "status": f"Document evidence insufficient ({reason}). Searching external sources..."
                            })

                    elif node_name == "web_search":
                        web_docs = node_output.get("web_docs", [])
                        yield format_sse("step", {
                            "name": "web_search",
                            "status": f"Retrieved {len(web_docs)} live web sources from Tavily."
                        })

                    elif node_name in ("generate_answer", "generate_refusal"):
                        yield format_sse("step", {
                            "name": node_name,
                            "status": "Finalizing answer and references..."
                        })

            # Emit final answer event
            yield format_sse("answer", {
                "answer": last_state.get("final_answer", ""),
                "sources_used": last_state.get("sources_used", "None"),
                "citations": last_state.get("citations", []),
                "mode": last_state.get("mode", request.mode),
                "chat_session_id": str(session_uuid)
            })

            yield format_sse("complete", {
                "chat_session_id": str(session_uuid),
                "status": "done"
            })

        except Exception as e:
            logger.error(f"Chat streaming error: {e}")
            yield format_sse("error", {
                "message": "AI Studio encountered an unexpected issue while generating the response.",
                "detail": str(e) if os.getenv("TESTING") else None
            })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

