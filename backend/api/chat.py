import uuid
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, status, File, UploadFile, Form
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

    # 4. Save chunks to database
    chunk_records = []
    for c in chunks:
        chunk_records.append(
            DocumentChunk(
                user_id=user.id,
                chat_session_id=session_uuid,
                filename=clean_name,
                page_number=c.get("page_number"),
                chunk_index=c.get("chunk_index", 0),
                content=c.get("content", ""),
                embedding=None  # Embedding populated in Stage 5 or async
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
