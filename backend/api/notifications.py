import uuid
import json
import asyncio
import logging
from typing import Optional, List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Header, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update, func
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import User, Notification, get_async_session, async_session_maker, SQLAlchemyUserDatabase
from backend.models.schemas import (
    NotificationResponse,
    NotificationsListResponse,
    StreamTicketResponse
)
from backend.core.users import current_active_user, get_jwt_strategy, UserManager
from backend.services.notification_broker import notification_broker
from backend.services.notification_service import (
    get_user_unread_count,
    format_notification_dict
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["Notifications"])

async def get_user_from_auth_or_ticket(
    request: Request,
    authorization: Optional[str] = Header(None),
    ticket: Optional[str] = Query(None)
) -> User:
    """
    Authenticates SSE stream request via:
    1. 'Authorization: Bearer <token>' header (fetch-based SSE clients)
    2. Single-use short-lived stream ticket (never logs token or ticket)
    """
    # 1. Try Authorization header
    token = None
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1].strip()

    async with async_session_maker() as session:
        if token:
            try:
                strategy = get_jwt_strategy()
                user_db = SQLAlchemyUserDatabase(session, User)
                user_manager = UserManager(user_db)
                user = await strategy.read_token(token, user_manager)
                if user and user.is_active:
                    return user
            except Exception as e:
                logger.debug(f"Bearer token read failure: {e}")

        # 2. Try single-use stream ticket
        if ticket:
            user_id = notification_broker.consume_ticket(ticket)
            if user_id:
                user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
                if user and user.is_active:
                    return user

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired stream credential.")

@router.post("/ticket", response_model=StreamTicketResponse)
async def generate_stream_ticket(
    user: User = Depends(current_active_user)
):
    """
    Generates an ephemeral, single-use stream ticket for WebSocket or SSE connection
    without exposing JWT in URL parameters. Ticket expires in 30 seconds.
    """
    ticket = notification_broker.create_ticket(user.id)
    return {"ticket": ticket, "expires_in": int(notification_broker.TICKET_TTL_SECONDS)}

@router.get("", response_model=NotificationsListResponse)
async def get_notifications(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Fetches paginated list of notifications for current user with unread count."""
    query = select(Notification).where(
        Notification.recipient_id == user.id
    ).options(
        joinedload(Notification.actor),
        joinedload(Notification.post),
        joinedload(Notification.comment)
    ).order_by(
        Notification.updated_at.desc()
    ).limit(limit).offset(offset)

    result = await session.execute(query)
    notifs = result.scalars().all()

    formatted_notifs = []
    for n in notifs:
        formatted_notifs.append(await format_notification_dict(session, n))

    unread_count = await get_user_unread_count(session, user.id)

    return {
        "notifications": formatted_notifs,
        "unread_count": unread_count
    }

@router.get("/unread-count")
async def get_unread_count(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Fast lightweight endpoint to retrieve unread notification count."""
    count = await get_user_unread_count(session, user.id)
    return {"unread_count": count}

@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Marks a single notification as read."""
    query = select(Notification).where(
        Notification.id == notification_id,
        Notification.recipient_id == user.id
    )
    notif = (await session.execute(query)).scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found.")

    if not notif.is_read:
        notif.is_read = True
        await session.commit()

    unread_count = await get_user_unread_count(session, user.id)
    await notification_broker.broadcast_unread_count(user.id, unread_count)

    return {"message": "Notification marked as read", "unread_count": unread_count}

@router.post("/read-all")
async def mark_all_read(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """Marks all unread notifications as read for current user."""
    stmt = update(Notification).where(
        Notification.recipient_id == user.id,
        Notification.is_read == False
    ).values(is_read=True)

    await session.execute(stmt)
    await session.commit()

    await notification_broker.broadcast_unread_count(user.id, 0)
    return {"message": "All notifications marked as read", "unread_count": 0}

@router.get("/stream")
async def stream_notifications(
    request: Request,
    user: User = Depends(get_user_from_auth_or_ticket)
):
    """
    Real-time Server-Sent Events (SSE) stream for instant in-app notification alerts.
    - Zero cost, in-memory multi-tab broadcasting.
    - Sends heartbeat ping every 15 seconds.
    - Max stream duration of 15 minutes before cleanly requesting client reconnect.
    - Set X-Accel-Buffering: no for proxy buffering avoidance.
    """
    queue = await notification_broker.register_connection(user.id)
    HEARTBEAT_INTERVAL = 15.0  # seconds
    MAX_STREAM_DURATION = 900.0  # 15 minutes

    async def event_generator():
        start_time = asyncio.get_event_loop().time()
        disconnect_task = asyncio.create_task(request.is_disconnected())
        try:
            # Send initial connection event with current unread count
            async with async_session_maker() as session:
                unread_count = await get_user_unread_count(session, user.id)
            
            initial_data = json.dumps({"status": "connected", "unread_count": unread_count})
            yield f"event: connected\ndata: {initial_data}\n\n"

            while True:
                if disconnect_task.done() and disconnect_task.result():
                    break

                # Check stream duration limit
                now = asyncio.get_event_loop().time()
                if (now - start_time) >= MAX_STREAM_DURATION:
                    yield "event: reconnect\ndata: {}\n\n"
                    break

                get_task = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait(
                    [get_task, disconnect_task],
                    timeout=HEARTBEAT_INTERVAL,
                    return_when=asyncio.FIRST_COMPLETED
                )

                if disconnect_task in done:
                    get_task.cancel()
                    break

                if get_task in done:
                    item = get_task.result()
                    event_type = item.get("event", "message")
                    data_str = json.dumps(item.get("data", {}))
                    yield f"event: {event_type}\ndata: {data_str}\n\n"

                    if event_type == "close":
                        break
                else:
                    # Heartbeat interval elapsed
                    get_task.cancel()
                    yield ": ping\n\n"

        except asyncio.CancelledError:
            pass
        finally:
            if not disconnect_task.done():
                disconnect_task.cancel()
            await notification_broker.unregister_connection(user.id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
