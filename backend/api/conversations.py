import io
import uuid
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Form, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import User, get_async_session
from backend.models.schemas import (
    ConversationResponse,
    DirectMessageResponse,
    ConversationCreateRequest,
    MessagesListResponse
)
from backend.core.users import current_active_user
from backend.core.images import uploader
from backend.services.conversation_service import (
    get_or_create_conversation,
    get_user_conversations,
    get_conversation_by_id,
    delete_conversation,
    get_conversation_messages,
    send_message,
    mark_conversation_as_read,
    format_message_response,
    format_conversation_response
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/conversations", tags=["Conversations"])

MAX_CHAT_FILE_SIZE_MB = 50
MAX_BYTES = MAX_CHAT_FILE_SIZE_MB * 1024 * 1024

@router.get("", response_model=List[ConversationResponse])
async def list_conversations(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Retrieves all 1-on-1 conversations for current user with unread counts and last message."""
    conversations = await get_user_conversations(session, user.id)
    return conversations

@router.post("", response_model=ConversationResponse)
async def create_conversation(
    request: ConversationCreateRequest,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Gets existing conversation or starts a new one with recipient."""
    conv = await get_or_create_conversation(session, user, request.recipient_id)
    return format_conversation_response(conv, user.id, unread_count=0)

@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Retrieves conversation details if user is a participant."""
    conv = await get_conversation_by_id(session, conversation_id, user.id)
    return format_conversation_response(conv, user.id)

@router.delete("/{conversation_id}")
async def remove_conversation(
    conversation_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Deletes conversation and its entire history."""
    await delete_conversation(session, conversation_id, user.id)
    return {"message": "Conversation deleted successfully."}

@router.get("/{conversation_id}/messages", response_model=MessagesListResponse)
async def get_messages(
    conversation_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Retrieves paginated messages in conversation."""
    messages = await get_conversation_messages(session, conversation_id, user.id, limit=limit, offset=offset)
    formatted = [format_message_response(m) for m in messages]
    return {
        "messages": formatted,
        "has_more": len(messages) == limit
    }

@router.post("/{conversation_id}/messages", response_model=DirectMessageResponse)
async def post_message(
    conversation_id: uuid.UUID,
    text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Sends a text message and/or file attachment to conversation, uploading attachment to Cloudinary."""
    attachment_url = None
    attachment_name = None
    attachment_type = None
    attachment_size = None

    if file and file.filename:
        file_bytes = await file.read()
        if len(file_bytes) > MAX_BYTES:
            raise HTTPException(status_code=413, detail=f"File exceeds maximum allowed size of {MAX_CHAT_FILE_SIZE_MB}MB.")
        if len(file_bytes) == 0:
            raise HTTPException(status_code=400, detail="The file is corrupted or empty.")

        content_type = file.content_type or "application/octet-stream"
        resource_type = "image" if content_type.startswith("image/") else ("video" if content_type.startswith("video/") else "raw")

        try:
            upload_result = await run_in_threadpool(
                uploader.upload,
                io.BytesIO(file_bytes),
                folder="chat_attachments",
                resource_type=resource_type
            )
            attachment_url = upload_result.get("secure_url")
            attachment_name = file.filename
            attachment_type = content_type
            attachment_size = len(file_bytes)
        except Exception as e:
            logger.error(f"Cloudinary upload failed: {e}")
            raise HTTPException(status_code=502, detail="Failed to upload attachment to media storage.")

    new_msg = await send_message(
        session=session,
        conversation_id=conversation_id,
        sender=user,
        text=text,
        attachment_url=attachment_url,
        attachment_name=attachment_name,
        attachment_type=attachment_type,
        attachment_size=attachment_size
    )

    return format_message_response(new_msg)

@router.patch("/{conversation_id}/read")
async def mark_read(
    conversation_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Marks all received messages in conversation as read."""
    marked = await mark_conversation_as_read(session, conversation_id, user.id)
    return {"message": "Conversation marked as read.", "marked_read": marked}
