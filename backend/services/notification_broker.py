import uuid
import time
import json
import secrets
import asyncio
import logging
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger(__name__)

class NotificationBroker:
    """
    In-memory PubSub broker managing Server-Sent Events (SSE) connections,
    multi-tab broadcasting, connection limits per user, and single-use stream tickets.
    """
    MAX_CONNECTIONS_PER_USER = 5
    TICKET_TTL_SECONDS = 30.0

    def __init__(self):
        # user_id -> List of asyncio.Queue
        self._connections: Dict[uuid.UUID, List[asyncio.Queue]] = {}
        # ticket_str -> (user_id, expiry_timestamp)
        self._tickets: Dict[str, Tuple[uuid.UUID, float]] = {}
        # (user_id, action) -> List of timestamps
        self._rate_limits: Dict[Tuple[uuid.UUID, str], List[float]] = {}
        self._lock = asyncio.Lock()

    def _cleanup_stale_rate_limits(self, now: Optional[float] = None):
        """Purges rate-limit keys where all recorded timestamps are older than 120s to guarantee bounded memory."""
        curr_time = now if now is not None else time.time()
        cutoff = curr_time - 120.0
        keys_to_delete = [
            k for k, timestamps in self._rate_limits.items()
            if not timestamps or timestamps[-1] <= cutoff
        ]
        for k in keys_to_delete:
            self._rate_limits.pop(k, None)

    def check_rate_limit(self, user_id: uuid.UUID, action: str, max_requests: int = 60, window_seconds: float = 60.0) -> bool:
        """
        In-memory sliding window rate limiter per user and action.
        Automatically prunes expired timestamps and stale keys to ensure bounded memory.
        Returns True if allowed, False if rate limit exceeded.
        """
        now = time.time()
        self._cleanup_counter = getattr(self, "_cleanup_counter", 0) + 1
        if self._cleanup_counter >= 50 or len(self._rate_limits) > 500:
            self._cleanup_stale_rate_limits(now)
            self._cleanup_counter = 0

        cutoff = now - window_seconds
        key = (user_id, action)
        timestamps = self._rate_limits.get(key, [])
        valid_timestamps = [t for t in timestamps if t > cutoff]
        if len(valid_timestamps) >= max_requests:
            self._rate_limits[key] = valid_timestamps
            return False
        valid_timestamps.append(now)
        self._rate_limits[key] = valid_timestamps
        return True

    def create_ticket(self, user_id: uuid.UUID) -> str:
        """Generates a secure, short-lived, single-use stream ticket. Never log this ticket."""
        ticket = secrets.token_urlsafe(32)
        expiry = time.time() + self.TICKET_TTL_SECONDS
        self._cleanup_expired_tickets()
        self._tickets[ticket] = (user_id, expiry)
        return ticket

    def consume_ticket(self, ticket: Optional[str]) -> Optional[uuid.UUID]:
        """Validates and immediately consumes a single-use stream ticket. Returns user_id if valid."""
        if not ticket or not isinstance(ticket, str):
            return None
        self._cleanup_expired_tickets()
        entry = self._tickets.pop(ticket, None)
        if not entry:
            return None
        user_id, expiry = entry
        if time.time() > expiry:
            return None
        return user_id

    def _cleanup_expired_tickets(self):
        """Purges expired tickets from in-memory cache."""
        now = time.time()
        expired = [t for t, (_, exp) in self._tickets.items() if now > exp]
        for t in expired:
            self._tickets.pop(t, None)

    async def register_connection(self, user_id: uuid.UUID) -> asyncio.Queue:
        """
        Registers an active SSE stream queue for the user.
        Limits concurrent streams per user to MAX_CONNECTIONS_PER_USER,
        closing the oldest stream gracefully if exceeded.
        """
        queue: asyncio.Queue = asyncio.Queue()
        async with self._lock:
            streams = self._connections.setdefault(user_id, [])
            if len(streams) >= self.MAX_CONNECTIONS_PER_USER:
                oldest_queue = streams.pop(0)
                try:
                    await oldest_queue.put({
                        "event": "close",
                        "data": {"reason": "Max concurrent streams exceeded for user session."}
                    })
                except Exception:
                    pass
            streams.append(queue)
        return queue

    async def unregister_connection(self, user_id: uuid.UUID, queue: asyncio.Queue):
        """Removes the disconnected SSE queue for the user."""
        async with self._lock:
            if user_id in self._connections:
                if queue in self._connections[user_id]:
                    self._connections[user_id].remove(queue)
                if not self._connections[user_id]:
                    self._connections.pop(user_id, None)

    async def broadcast(self, user_id: uuid.UUID, event_type: str, data: Dict[str, Any]):
        """Broadcasts an event message to all active stream queues for the target user."""
        async with self._lock:
            queues = list(self._connections.get(user_id, []))
        
        for q in queues:
            try:
                q.put_nowait({
                    "event": event_type,
                    "data": data
                })
            except Exception as e:
                logger.debug(f"Failed to push SSE event to queue: {e}")

    async def broadcast_unread_count(self, user_id: uuid.UUID, unread_count: int):
        """Convenience method to broadcast updated unread count to all user tabs."""
        await self.broadcast(user_id, "count_update", {"unread_count": unread_count})

notification_broker = NotificationBroker()
