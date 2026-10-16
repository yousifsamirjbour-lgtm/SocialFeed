import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import User, post, Comment, Like, SavedPost, CommentLike, Notification
from backend.services.notification_broker import notification_broker

logger = logging.getLogger(__name__)

async def get_user_unread_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    """Returns the total number of unread notifications for a user."""
    query = select(func.count(Notification.id)).where(
        Notification.recipient_id == user_id,
        Notification.is_read == False
    )
    res = await session.execute(query)
    return res.scalar() or 0

async def format_notification_dict(session: AsyncSession, notification: Notification) -> Dict[str, Any]:
    """Formats a Notification database model into a dictionary matching NotificationResponse."""
    # Ensure actor, post, and comment relationships are loaded
    actor_name = notification.actor.name if notification.actor else "User"
    actor_avatar = notification.actor.profile_picture_url if notification.actor else None

    actors_count = 1
    if notification.type == "post_like" and notification.post_id:
        count_q = select(func.count(Like.user_id)).where(
            Like.post_id == notification.post_id,
            Like.user_id != notification.recipient_id
        )
        actors_count = max(1, (await session.execute(count_q)).scalar() or 1)
    elif notification.type == "comment_like" and notification.comment_id:
        count_q = select(func.count(CommentLike.user_id)).where(
            CommentLike.comment_id == notification.comment_id,
            CommentLike.user_id != notification.recipient_id
        )
        actors_count = max(1, (await session.execute(count_q)).scalar() or 1)
    elif notification.type == "post_save" and notification.post_id:
        count_q = select(func.count(SavedPost.user_id)).where(
            SavedPost.post_id == notification.post_id,
            SavedPost.user_id != notification.recipient_id
        )
        actors_count = max(1, (await session.execute(count_q)).scalar() or 1)

    post_url = notification.post.url if notification.post else None
    post_file_type = notification.post.file_type if notification.post else None

    comment_text = None
    if notification.extra_data and isinstance(notification.extra_data, dict):
        comment_text = notification.extra_data.get("text")
    elif notification.comment:
        comment_text = notification.comment.text

    return {
        "id": str(notification.id),
        "type": notification.type,
        "actor": {
            "id": str(notification.actor_id),
            "name": actor_name,
            "profile_picture_url": actor_avatar
        },
        "actors_count": actors_count,
        "post_id": str(notification.post_id) if notification.post_id else None,
        "comment_id": str(notification.comment_id) if notification.comment_id else None,
        "post_url": post_url,
        "post_file_type": post_file_type,
        "comment_text": comment_text,
        "extra_data": notification.extra_data,
        "is_read": bool(notification.is_read),
        "created_at": notification.created_at.isoformat() if notification.created_at else datetime.now(timezone.utc).isoformat(),
        "updated_at": notification.updated_at.isoformat() if notification.updated_at else datetime.now(timezone.utc).isoformat()
    }

async def notify_post_like(session: AsyncSession, post_id: uuid.UUID, actor_id: uuid.UUID):
    """Creates or updates a grouped post_like notification. Never notifies self."""
    post_obj = (await session.execute(select(post).where(post.id == post_id))).scalar_one_or_none()
    if not post_obj or post_obj.user_id == actor_id:
        return

    recipient_id = post_obj.user_id
    notif_q = select(Notification).where(
        Notification.recipient_id == recipient_id,
        Notification.post_id == post_id,
        Notification.type == "post_like"
    ).options(joinedload(Notification.actor), joinedload(Notification.post))
    existing_notif = (await session.execute(notif_q)).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if existing_notif:
        existing_notif.actor_id = actor_id
        existing_notif.updated_at = now
        existing_notif.is_read = False
        target_notif = existing_notif
    else:
        new_notif = Notification(
            recipient_id=recipient_id,
            actor_id=actor_id,
            type="post_like",
            post_id=post_id,
            is_read=False,
            created_at=now,
            updated_at=now
        )
        session.add(new_notif)
        target_notif = new_notif

    await session.commit()
    await session.refresh(target_notif)

    # Broadcast real-time SSE event
    actor_obj = (await session.execute(select(User).where(User.id == actor_id))).scalar_one_or_none()
    target_notif.actor = actor_obj
    target_notif.post = post_obj

    unread_count = await get_user_unread_count(session, recipient_id)
    payload = await format_notification_dict(session, target_notif)
    await notification_broker.broadcast(recipient_id, "new_notification", {
        "notification": payload,
        "unread_count": unread_count
    })

async def remove_post_like_notification(session: AsyncSession, post_id: uuid.UUID, actor_id: uuid.UUID):
    """Removes or updates grouped post_like notification when a like is undone."""
    post_obj = (await session.execute(select(post).where(post.id == post_id))).scalar_one_or_none()
    if not post_obj or post_obj.user_id == actor_id:
        return

    recipient_id = post_obj.user_id
    notif_q = select(Notification).where(
        Notification.recipient_id == recipient_id,
        Notification.post_id == post_id,
        Notification.type == "post_like"
    ).options(joinedload(Notification.actor), joinedload(Notification.post))
    existing_notif = (await session.execute(notif_q)).scalar_one_or_none()
    if not existing_notif:
        return

    # Check remaining likes excluding post owner
    remaining_q = select(Like).where(
        Like.post_id == post_id,
        Like.user_id != recipient_id
    ).order_by(Like.created_at.desc())
    remaining_likes = (await session.execute(remaining_q)).scalars().all()

    if not remaining_likes:
        notif_id = str(existing_notif.id)
        await session.delete(existing_notif)
        await session.commit()
        unread_count = await get_user_unread_count(session, recipient_id)
        await notification_broker.broadcast(recipient_id, "notification_removed", {
            "notification_id": notif_id,
            "unread_count": unread_count
        })
    else:
        latest_actor_id = remaining_likes[0].user_id
        latest_actor = (await session.execute(select(User).where(User.id == latest_actor_id))).scalar_one_or_none()
        existing_notif.actor_id = latest_actor_id
        existing_notif.actor = latest_actor
        existing_notif.updated_at = remaining_likes[0].created_at or datetime.now(timezone.utc)
        await session.commit()
        unread_count = await get_user_unread_count(session, recipient_id)
        payload = await format_notification_dict(session, existing_notif)
        await notification_broker.broadcast(recipient_id, "notification_updated", {
            "notification": payload,
            "unread_count": unread_count
        })

async def notify_comment_like(session: AsyncSession, comment_id: uuid.UUID, actor_id: uuid.UUID):
    """Creates or updates a grouped comment_like notification."""
    comment_q = select(Comment).where(Comment.id == comment_id).options(joinedload(Comment.post_parent))
    comment_obj = (await session.execute(comment_q)).scalar_one_or_none()
    if not comment_obj or comment_obj.user_id == actor_id:
        return

    recipient_id = comment_obj.user_id
    notif_q = select(Notification).where(
        Notification.recipient_id == recipient_id,
        Notification.comment_id == comment_id,
        Notification.type == "comment_like"
    ).options(joinedload(Notification.actor), joinedload(Notification.comment))
    existing_notif = (await session.execute(notif_q)).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if existing_notif:
        existing_notif.actor_id = actor_id
        existing_notif.updated_at = now
        existing_notif.is_read = False
        target_notif = existing_notif
    else:
        new_notif = Notification(
            recipient_id=recipient_id,
            actor_id=actor_id,
            type="comment_like",
            post_id=comment_obj.post_id,
            comment_id=comment_id,
            is_read=False,
            created_at=now,
            updated_at=now
        )
        session.add(new_notif)
        target_notif = new_notif

    await session.commit()
    await session.refresh(target_notif)

    actor_obj = (await session.execute(select(User).where(User.id == actor_id))).scalar_one_or_none()
    post_obj = (await session.execute(select(post).where(post.id == comment_obj.post_id))).scalar_one_or_none()
    target_notif.actor = actor_obj
    target_notif.comment = comment_obj
    target_notif.post = post_obj

    unread_count = await get_user_unread_count(session, recipient_id)
    payload = await format_notification_dict(session, target_notif)
    await notification_broker.broadcast(recipient_id, "new_notification", {
        "notification": payload,
        "unread_count": unread_count
    })

async def remove_comment_like_notification(session: AsyncSession, comment_id: uuid.UUID, actor_id: uuid.UUID):
    """Removes or updates grouped comment_like notification when unlike occurs."""
    comment_obj = (await session.execute(select(Comment).where(Comment.id == comment_id))).scalar_one_or_none()
    if not comment_obj or comment_obj.user_id == actor_id:
        return

    recipient_id = comment_obj.user_id
    notif_q = select(Notification).where(
        Notification.recipient_id == recipient_id,
        Notification.comment_id == comment_id,
        Notification.type == "comment_like"
    )
    existing_notif = (await session.execute(notif_q)).scalar_one_or_none()
    if not existing_notif:
        return

    remaining_q = select(CommentLike).where(
        CommentLike.comment_id == comment_id,
        CommentLike.user_id != recipient_id
    ).order_by(CommentLike.created_at.desc())
    remaining_likes = (await session.execute(remaining_q)).scalars().all()

    if not remaining_likes:
        notif_id = str(existing_notif.id)
        await session.delete(existing_notif)
        await session.commit()
        unread_count = await get_user_unread_count(session, recipient_id)
        await notification_broker.broadcast(recipient_id, "notification_removed", {
            "notification_id": notif_id,
            "unread_count": unread_count
        })
    else:
        latest_actor_id = remaining_likes[0].user_id
        latest_actor = (await session.execute(select(User).where(User.id == latest_actor_id))).scalar_one_or_none()
        existing_notif.actor_id = latest_actor_id
        existing_notif.actor = latest_actor
        existing_notif.updated_at = remaining_likes[0].created_at or datetime.now(timezone.utc)
        await session.commit()
        unread_count = await get_user_unread_count(session, recipient_id)
        payload = await format_notification_dict(session, existing_notif)
        await notification_broker.broadcast(recipient_id, "notification_updated", {
            "notification": payload,
            "unread_count": unread_count
        })

async def notify_post_comment(session: AsyncSession, comment_obj: Comment):
    """Creates a notification when someone comments on a post."""
    post_obj = (await session.execute(select(post).where(post.id == comment_obj.post_id))).scalar_one_or_none()
    if not post_obj or post_obj.user_id == comment_obj.user_id:
        return

    recipient_id = post_obj.user_id
    now = datetime.now(timezone.utc)
    new_notif = Notification(
        recipient_id=recipient_id,
        actor_id=comment_obj.user_id,
        type="comment",
        post_id=comment_obj.post_id,
        comment_id=comment_obj.id,
        extra_data={"text": comment_obj.text[:120]},
        is_read=False,
        created_at=now,
        updated_at=now
    )
    session.add(new_notif)
    await session.commit()
    await session.refresh(new_notif)

    actor_obj = (await session.execute(select(User).where(User.id == comment_obj.user_id))).scalar_one_or_none()
    new_notif.actor = actor_obj
    new_notif.post = post_obj
    new_notif.comment = comment_obj

    unread_count = await get_user_unread_count(session, recipient_id)
    payload = await format_notification_dict(session, new_notif)
    await notification_broker.broadcast(recipient_id, "new_notification", {
        "notification": payload,
        "unread_count": unread_count
    })

async def remove_comment_notifications(session: AsyncSession, comment_id: uuid.UUID):
    """Deletes notifications related to a deleted comment (both 'comment' and 'comment_like')."""
    notifs = (await session.execute(
        select(Notification).where(Notification.comment_id == comment_id)
    )).scalars().all()

    for notif in notifs:
        recipient_id = notif.recipient_id
        notif_id = str(notif.id)
        await session.delete(notif)
        await session.commit()
        unread_count = await get_user_unread_count(session, recipient_id)
        await notification_broker.broadcast(recipient_id, "notification_removed", {
            "notification_id": notif_id,
            "unread_count": unread_count
        })

async def notify_post_save(session: AsyncSession, post_id: uuid.UUID, actor_id: uuid.UUID):
    """Creates or updates a post_save notification."""
    post_obj = (await session.execute(select(post).where(post.id == post_id))).scalar_one_or_none()
    if not post_obj or post_obj.user_id == actor_id:
        return

    recipient_id = post_obj.user_id
    notif_q = select(Notification).where(
        Notification.recipient_id == recipient_id,
        Notification.post_id == post_id,
        Notification.type == "post_save"
    ).options(joinedload(Notification.actor), joinedload(Notification.post))
    existing_notif = (await session.execute(notif_q)).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if existing_notif:
        existing_notif.actor_id = actor_id
        existing_notif.updated_at = now
        existing_notif.is_read = False
        target_notif = existing_notif
    else:
        new_notif = Notification(
            recipient_id=recipient_id,
            actor_id=actor_id,
            type="post_save",
            post_id=post_id,
            is_read=False,
            created_at=now,
            updated_at=now
        )
        session.add(new_notif)
        target_notif = new_notif

    await session.commit()
    await session.refresh(target_notif)

    actor_obj = (await session.execute(select(User).where(User.id == actor_id))).scalar_one_or_none()
    target_notif.actor = actor_obj
    target_notif.post = post_obj

    unread_count = await get_user_unread_count(session, recipient_id)
    payload = await format_notification_dict(session, target_notif)
    await notification_broker.broadcast(recipient_id, "new_notification", {
        "notification": payload,
        "unread_count": unread_count
    })

async def remove_post_save_notification(session: AsyncSession, post_id: uuid.UUID, actor_id: uuid.UUID):
    """Removes or updates post_save notification when unsaved."""
    post_obj = (await session.execute(select(post).where(post.id == post_id))).scalar_one_or_none()
    if not post_obj or post_obj.user_id == actor_id:
        return

    recipient_id = post_obj.user_id
    notif_q = select(Notification).where(
        Notification.recipient_id == recipient_id,
        Notification.post_id == post_id,
        Notification.type == "post_save"
    )
    existing_notif = (await session.execute(notif_q)).scalar_one_or_none()
    if not existing_notif:
        return

    remaining_q = select(SavedPost).where(
        SavedPost.post_id == post_id,
        SavedPost.user_id != recipient_id
    ).order_by(SavedPost.created_at.desc())
    remaining_saves = (await session.execute(remaining_q)).scalars().all()

    if not remaining_saves:
        notif_id = str(existing_notif.id)
        await session.delete(existing_notif)
        await session.commit()
        unread_count = await get_user_unread_count(session, recipient_id)
        await notification_broker.broadcast(recipient_id, "notification_removed", {
            "notification_id": notif_id,
            "unread_count": unread_count
        })
    else:
        latest_actor_id = remaining_saves[0].user_id
        latest_actor = (await session.execute(select(User).where(User.id == latest_actor_id))).scalar_one_or_none()
        existing_notif.actor_id = latest_actor_id
        existing_notif.actor = latest_actor
        existing_notif.updated_at = remaining_saves[0].created_at or datetime.now(timezone.utc)
        await session.commit()
        unread_count = await get_user_unread_count(session, recipient_id)
        payload = await format_notification_dict(session, existing_notif)
        await notification_broker.broadcast(recipient_id, "notification_updated", {
            "notification": payload,
            "unread_count": unread_count
        })

async def notify_chat_message(
    session: AsyncSession,
    conversation_id: uuid.UUID,
    sender_id: uuid.UUID,
    recipient_id: uuid.UUID,
    message_text: Optional[str] = None,
    has_attachment: bool = False,
    attachment_type: Optional[str] = None
):
    """Creates or updates a chat_message notification for recipient. Never notifies self."""
    if recipient_id == sender_id:
        return

    now = datetime.now(timezone.utc)
    preview = message_text[:100] if message_text else ("Sent an attachment" if has_attachment else "Sent a message")
    
    notif_q = select(Notification).where(
        Notification.recipient_id == recipient_id,
        Notification.type == "chat_message",
        Notification.is_read == False
    )
    unreads = (await session.execute(notif_q)).scalars().all()
    existing_notif = next(
        (n for n in unreads if n.extra_data and isinstance(n.extra_data, dict) and n.extra_data.get("conversation_id") == str(conversation_id)),
        None
    )

    if existing_notif:
        existing_notif.actor_id = sender_id
        existing_notif.updated_at = now
        existing_notif.is_read = False
        existing_notif.extra_data = {
            "conversation_id": str(conversation_id),
            "text": preview,
            "has_attachment": has_attachment,
            "attachment_type": attachment_type
        }
        target_notif = existing_notif
    else:
        new_notif = Notification(
            recipient_id=recipient_id,
            actor_id=sender_id,
            type="chat_message",
            is_read=False,
            extra_data={
                "conversation_id": str(conversation_id),
                "text": preview,
                "has_attachment": has_attachment,
                "attachment_type": attachment_type
            },
            created_at=now,
            updated_at=now
        )
        session.add(new_notif)
        target_notif = new_notif

    await session.commit()
    await session.refresh(target_notif)

    sender_obj = (await session.execute(select(User).where(User.id == sender_id))).scalar_one_or_none()
    target_notif.actor = sender_obj

    unread_count = await get_user_unread_count(session, recipient_id)
    payload = await format_notification_dict(session, target_notif)
    await notification_broker.broadcast(recipient_id, "new_notification", {
        "notification": payload,
        "unread_count": unread_count
    })

async def clear_chat_notifications(session: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID):
    """Marks all chat_message notifications for this conversation as read for the user."""
    notif_q = select(Notification).where(
        Notification.recipient_id == user_id,
        Notification.type == "chat_message",
        Notification.is_read == False
    )
    unreads = (await session.execute(notif_q)).scalars().all()
    matched = [n for n in unreads if n.extra_data and isinstance(n.extra_data, dict) and n.extra_data.get("conversation_id") == str(conversation_id)]
    if not matched:
        return
    for n in matched:
        n.is_read = True
    await session.commit()
    unread_count = await get_user_unread_count(session, user_id)
    await notification_broker.broadcast_unread_count(user_id, unread_count)

