import uuid
import asyncio
import logging
from datetime import date, datetime, timezone
from typing import Dict, Any, Optional, List, Tuple
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import VoiceDailyQuota, async_session_maker

logger = logging.getLogger(__name__)

# Daily Voice Quota Limits
MAX_DAILY_VOICE_SECONDS = 900  # 15 minutes of audio per day (zero-cost safe tier)
MAX_DAILY_VOICE_TURNS = 60     # 60 voice conversational turns per day

class VoiceSession:
    """Represents an active in-memory voice conversation session."""
    def __init__(self, user_id: uuid.UUID, session_id: uuid.UUID):
        self.user_id = user_id
        self.session_id = session_id
        self.created_at = datetime.now(timezone.utc)
        self.history: List[Dict[str, str]] = []  # In-memory short history
        self.active_turn_id: Optional[int] = None
        self.active_turn_task: Optional[asyncio.Task] = None
        self.last_audio_header: Optional[Dict[str, Any]] = None

    def cancel_active_turn(self, turn_id: Optional[int] = None):
        """Cancels the running asyncio task for the current turn on barge-in/interruption."""
        if turn_id is not None and self.active_turn_id is not None and self.active_turn_id > turn_id:
            logger.info(f"Ignoring stale interrupt for turn {turn_id} (active turn is {self.active_turn_id})")
            return

        if self.active_turn_task and not self.active_turn_task.done():
            logger.info(f"Interrupting active voice turn {self.active_turn_id} for user {self.user_id}")
            self.active_turn_task.cancel()
        self.active_turn_id = None
        self.active_turn_task = None
        self.last_audio_header = None

    def add_history(self, role: str, content: str):
        self.history.append({"role": role, "content": content})
        if len(self.history) > 6:
            self.history = self.history[-6:]

class VoiceSessionRegistry:
    """Singleton registry tracking active live voice WebSocket connections."""
    def __init__(self):
        # Map user_id (UUID) -> VoiceSession
        self._active_sessions: Dict[uuid.UUID, VoiceSession] = {}
        self._lock = asyncio.Lock()

    async def register_session(self, user_id: uuid.UUID) -> VoiceSession:
        async with self._lock:
            # If user already has an active session, cancel its active tasks
            if user_id in self._active_sessions:
                old_session = self._active_sessions[user_id]
                old_session.cancel_active_turn()

            session = VoiceSession(user_id=user_id, session_id=uuid.uuid4())
            self._active_sessions[user_id] = session
            return session

    async def unregister_session(self, user_id: uuid.UUID, session_id: uuid.UUID):
        async with self._lock:
            current = self._active_sessions.get(user_id)
            if current and current.session_id == session_id:
                current.cancel_active_turn()
                del self._active_sessions[user_id]

    async def check_and_update_quota(
        self,
        user_id: uuid.UUID,
        seconds_to_add: int = 0,
        turns_to_add: int = 0
    ) -> Tuple[bool, int, int]:
        """
        Queries and updates per-user daily quota in PostgreSQL.
        Returns: (is_allowed, seconds_left, turns_left)
        """
        today = date.today()
        async with async_session_maker() as session:
            stmt = select(VoiceDailyQuota).where(
                VoiceDailyQuota.user_id == user_id,
                VoiceDailyQuota.usage_date == today
            )
            res = await session.execute(stmt)
            quota_record = res.scalar_one_or_none()

            if not quota_record:
                quota_record = VoiceDailyQuota(
                    user_id=user_id,
                    usage_date=today,
                    seconds_used=0,
                    turns_count=0
                )
                session.add(quota_record)

            curr_seconds = quota_record.seconds_used
            curr_turns = quota_record.turns_count

            # Check if current limits exceeded
            if curr_seconds >= MAX_DAILY_VOICE_SECONDS or curr_turns >= MAX_DAILY_VOICE_TURNS:
                return False, 0, 0

            # If adding usage
            if seconds_to_add > 0 or turns_to_add > 0:
                quota_record.seconds_used += seconds_to_add
                quota_record.turns_count += turns_to_add
                quota_record.updated_at = datetime.now(timezone.utc)
                await session.commit()
                curr_seconds = quota_record.seconds_used
                curr_turns = quota_record.turns_count

            seconds_left = max(0, MAX_DAILY_VOICE_SECONDS - curr_seconds)
            turns_left = max(0, MAX_DAILY_VOICE_TURNS - curr_turns)

            return True, seconds_left, turns_left

voice_registry = VoiceSessionRegistry()
