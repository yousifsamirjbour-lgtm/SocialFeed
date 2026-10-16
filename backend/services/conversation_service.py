import uuid
import logging
from datetime import datetime, timezone
from typing import Tuple, List, Optional, Dict, Any
from fastapi import HTTPException
from sqlalchemy import select, func, or_, and_, update
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import User, Conversation, DirectMessage, Notification
from backend.services.notification_broker import notification_broker
from backend.services.notification_service import notify_chat_message, clear_chat_notifications

logger = logging.getLogger(__name__)

def get_canonical_user_ids(user_a_id: uuid.UUID, user_b_id: uuid.UUID) -> Tuple[uuid.UUID, uuid.UUID]:
    """Returns canonical sorted tuple (user1_id, user2_id) to guarantee a single row per pair."""
    if user_a_id == user_b_id:
        raise HTTPException(status_code=400, detail="Cannot start a conversation with yourself.")
    # Sort by UUID string representation for consistent deterministic ordering
    if str(user_a_id) < str(user_b_id):
        return user_a_id, user_b_id
    return user_b_id, user_a_id

def format_participant(user: Optional[User]) -> Dict[str, Any]:
    """Formats User model into participant dictionary."""
    if not user:
        return {
            "id": str(uuid.uuid4()),
            "name": "Unknown User",
            "profile_picture_url": None
        }
    return {
        "id": str(user.id),
        "name": user.name or "User",
        "profile_picture_url": user.profile_picture_url
    }

def format_message_response(msg: DirectMessage) -> Dict[str, Any]:
    """Formats DirectMessage database model into DirectMessageResponse schema dict."""
    return {
        "id": str(msg.id),
        "conversation_id": str(msg.conversation_id),
        "sender_id": str(msg.sender_id),
        "sender": format_participant(msg.sender),
        "text": msg.text,
        "attachment_url": msg.attachment_url,
        "attachment_name": msg.attachment_name,
        "attachment_type": msg.attachment_type,
        "attachment_size": msg.attachment_size,
        "is_read": bool(msg.is_read),
        "created_at": msg.created_at.isoformat() if msg.created_at else datetime.now(timezone.utc).isoformat()
    }

def format_conversation_response(conv: Conversation, current_user_id: uuid.UUID, unread_count: int = 0) -> Dict[str, Any]:
    """Formats Conversation database model with the other participant."""
    other_user = conv.user2 if conv.user1_id == current_user_id else conv.user1
    return {
        "id": str(conv.id),
        "participant": format_participant(other_user),
        "last_message_text": conv.last_message_text,
        "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else (conv.created_at or datetime.now(timezone.utc)).isoformat(),
        "last_message_sender_id": str(conv.last_message_sender_id) if conv.last_message_sender_id else None,
        "unread_count": unread_count,
        "created_at": conv.created_at.isoformat() if conv.created_at else datetime.now(timezone.utc).isoformat(),
        "updated_at": conv.updated_at.isoformat() if conv.updated_at else datetime.now(timezone.utc).isoformat()
    }

async def get_or_create_conversation(session: AsyncSession, current_user: User, recipient_id: uuid.UUID) -> Conversation:
    """Finds existing conversation between users or creates a new one."""
    if current_user.id == recipient_id:
        raise HTTPException(status_code=400, detail="Cannot start a conversation with yourself.")

    recipient_q = select(User).where(User.id == recipient_id)
    recipient = (await session.execute(recipient_q)).scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient user not found.")

    u1, u2 = get_canonical_user_ids(current_user.id, recipient_id)

    conv_q = select(Conversation).where(
        Conversation.user1_id == u1,
        Conversation.user2_id == u2
    ).options(joinedload(Conversation.user1), joinedload(Conversation.user2))
    
    conv = (await session.execute(conv_q)).scalar_one_or_none()
    if not conv:
        now = datetime.now(timezone.utc)
        conv = Conversation(
            user1_id=u1,
            user2_id=u2,
            last_message_text=None,
            last_message_at=now,
            created_at=now,
            updated_at=now
        )
        session.add(conv)
        await session.commit()
        await session.refresh(conv)

        # Reload relationships
        conv_reload = select(Conversation).where(Conversation.id == conv.id).options(
            joinedload(Conversation.user1),
            joinedload(Conversation.user2)
        )
        conv = (await session.execute(conv_reload)).scalar_one()

    return conv

async def get_user_conversations(session: AsyncSession, current_user_id: uuid.UUID) -> List[Dict[str, Any]]:
    """Returns list of conversations for current_user sorted by last_message_at desc with unread counts."""
    conv_q = select(Conversation).where(
        or_(
            Conversation.user1_id == current_user_id,
            Conversation.user2_id == current_user_id
        )
    ).options(
        joinedload(Conversation.user1),
        joinedload(Conversation.user2)
    ).order_by(Conversation.last_message_at.desc())

    conversations = (await session.execute(conv_q)).scalars().all()
    results = []

    for conv in conversations:
        # Calculate unread count for current user in this conversation
        unread_q = select(func.count(DirectMessage.id)).where(
            DirectMessage.conversation_id == conv.id,
            DirectMessage.sender_id != current_user_id,
            DirectMessage.is_read == False
        )
        unread_count = (await session.execute(unread_q)).scalar() or 0
        results.append(format_conversation_response(conv, current_user_id, unread_count))

    return results

async def get_conversation_by_id(session: AsyncSession, conversation_id: uuid.UUID, current_user_id: uuid.UUID) -> Conversation:
    """Retrieves conversation by ID and validates current user is a participant."""
    conv_q = select(Conversation).where(
        Conversation.id == conversation_id
    ).options(
        joinedload(Conversation.user1),
        joinedload(Conversation.user2)
    )
    conv = (await session.execute(conv_q)).scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    if current_user_id not in (conv.user1_id, conv.user2_id):
        raise HTTPException(status_code=403, detail="You do not have permission to view this conversation.")

    return conv

async def delete_conversation(session: AsyncSession, conversation_id: uuid.UUID, current_user_id: uuid.UUID) -> bool:
    """Deletes conversation and all child messages if user is a participant."""
    conv = await get_conversation_by_id(session, conversation_id, current_user_id)
    other_user_id = conv.user2_id if conv.user1_id == current_user_id else conv.user1_id

    # Remove any notifications tied to this conversation
    notif_q = select(Notification).where(
        Notification.type == "chat_message"
    )
    all_notifs = (await session.execute(notif_q)).scalars().all()
    for n in all_notifs:
        if n.extra_data and isinstance(n.extra_data, dict) and n.extra_data.get("conversation_id") == str(conversation_id):
            await session.delete(n)

    await session.delete(conv)
    await session.commit()

    # Broadcast conversation_deleted event to both participants
    delete_event = {"conversation_id": str(conversation_id)}
    await notification_broker.broadcast(current_user_id, "conversation_deleted", delete_event)
    await notification_broker.broadcast(other_user_id, "conversation_deleted", delete_event)

    return True

async def get_conversation_messages(
    session: AsyncSession,
    conversation_id: uuid.UUID,
    current_user_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0
) -> List[DirectMessage]:
    """Retrieves chronological messages for conversation."""
    await get_conversation_by_id(session, conversation_id, current_user_id)

    msg_q = select(DirectMessage).where(
        DirectMessage.conversation_id == conversation_id
    ).options(
        joinedload(DirectMessage.sender)
    ).order_by(
        DirectMessage.created_at.asc()
    ).limit(limit).offset(offset)

    messages = (await session.execute(msg_q)).scalars().all()
    return messages

async def send_message(
    session: AsyncSession,
    conversation_id: uuid.UUID,
    sender: User,
    text: Optional[str] = None,
    attachment_url: Optional[str] = None,
    attachment_name: Optional[str] = None,
    attachment_type: Optional[str] = None,
    attachment_size: Optional[int] = None
) -> DirectMessage:
    """Persists a new message in conversation, updates conversation metadata, and broadcasts real-time SSE."""
    conv = await get_conversation_by_id(session, conversation_id, sender.id)
    recipient_id = conv.user2_id if conv.user1_id == sender.id else conv.user1_id

    cleaned_text = text.strip() if (text and text.strip()) else None
    if not cleaned_text and not attachment_url:
        raise HTTPException(status_code=400, detail="Message must include text or an attachment.")

    now = datetime.now(timezone.utc)
    new_msg = DirectMessage(
        conversation_id=conversation_id,
        sender_id=sender.id,
        text=cleaned_text,
        attachment_url=attachment_url,
        attachment_name=attachment_name,
        attachment_type=attachment_type,
        attachment_size=attachment_size,
        is_read=False,
        created_at=now
    )
    session.add(new_msg)

    # Update conversation's last_message attributes
    last_text = cleaned_text if cleaned_text else (f"Sent an attachment: {attachment_name}" if attachment_name else "Sent an attachment")
    conv.last_message_text = last_text[:100]
    conv.last_message_at = now
    conv.last_message_sender_id = sender.id
    conv.updated_at = now

    await session.commit()
    await session.refresh(new_msg)

    new_msg.sender = sender
    msg_dict = format_message_response(new_msg)

    # 1. Broadcast chat_message SSE event to both participants
    await notification_broker.broadcast(recipient_id, "chat_message", msg_dict)
    await notification_broker.broadcast(sender.id, "chat_message", msg_dict)

    # 2. Trigger in-app notification for recipient
    await notify_chat_message(
        session=session,
        conversation_id=conversation_id,
        sender_id=sender.id,
        recipient_id=recipient_id,
        message_text=cleaned_text,
        has_attachment=bool(attachment_url),
        attachment_type=attachment_type
    )

    return new_msg

async def mark_conversation_as_read(session: AsyncSession, conversation_id: uuid.UUID, current_user_id: uuid.UUID) -> int:
    """Marks all unread messages from other user as read in conversation."""
    await get_conversation_by_id(session, conversation_id, current_user_id)

    update_stmt = (
        update(DirectMessage)
        .where(
            DirectMessage.conversation_id == conversation_id,
            DirectMessage.sender_id != current_user_id,
            DirectMessage.is_read == False
        )
        .values(is_read=True)
    )
    result = await session.execute(update_stmt)
    updated_count = result.rowcount

    # Clear chat notifications for this conversation
    await clear_chat_notifications(session, conversation_id, current_user_id)
    await session.commit()

    if updated_count > 0:
        # Broadcast read receipt to sender
        conv = await get_conversation_by_id(session, conversation_id, current_user_id)
        other_user_id = conv.user2_id if conv.user1_id == current_user_id else conv.user1_id
        await notification_broker.broadcast(other_user_id, "messages_read", {
            "conversation_id": str(conversation_id),
            "reader_id": str(current_user_id)
        })

    return updated_count
