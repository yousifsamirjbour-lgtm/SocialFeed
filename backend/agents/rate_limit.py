import os
import time
import hashlib
from typing import Dict, List, Tuple, Optional, Any
from datetime import datetime, timezone

# Configuration with safe $0.00 defaults
USER_RATE_LIMIT_PER_HOUR = int(os.getenv("AI_STUDIO_USER_RATE_LIMIT_PER_HOUR", "5"))
GLOBAL_DAILY_CAP = int(os.getenv("AI_STUDIO_GLOBAL_DAILY_CAP", "50"))
MAX_CRITIQUE_ROUNDS = int(os.getenv("AI_STUDIO_MAX_CRITIQUE_ROUNDS", "2"))
MAX_SEARCH_RESULTS = int(os.getenv("AI_STUDIO_MAX_SEARCH_RESULTS", "3"))
MAX_QUERY_LENGTH = int(os.getenv("AI_STUDIO_MAX_QUERY_LENGTH", "300"))
CACHE_TTL_SECONDS = int(os.getenv("AI_STUDIO_CACHE_TTL_SECONDS", "300"))

class CostGuard:
    """In-memory rate limiter, global cap, and result cache for AI Studio."""
    def __init__(self):
        # user_id -> list of timestamps
        self.user_timestamps: Dict[str, List[float]] = {}
        # current date str (YYYY-MM-DD) -> count
        self.global_daily_counts: Dict[str, int] = {}
        # query_hash -> (timestamp, result_dict)
        self.cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        # aggregate telemetry (no secrets)
        self.total_runs: int = 0
        self.total_llm_calls: int = 0
        self.total_approx_tokens: int = 0

    def check_limits(self, user_id: str) -> Tuple[bool, Optional[str]]:
        now = time.time()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # 1. Check global daily cap
        daily_count = self.global_daily_counts.get(today, 0)
        if daily_count >= GLOBAL_DAILY_CAP:
            return False, (
                f"Global daily capacity reached ({GLOBAL_DAILY_CAP} runs). "
                "AI Studio is resting to protect free-tier limits. Please check back tomorrow at 00:00 UTC."
            )

        # 2. Check per-user rate limit (sliding 1-hour window)
        timestamps = self.user_timestamps.get(user_id, [])
        # filter out timestamps older than 1 hour (3600 seconds)
        recent_timestamps = [t for t in timestamps if now - t < 3600]
        self.user_timestamps[user_id] = recent_timestamps

        if len(recent_timestamps) >= USER_RATE_LIMIT_PER_HOUR:
            minutes_left = int((3600 - (now - recent_timestamps[0])) / 60) + 1
            return False, (
                f"You have reached your limit of {USER_RATE_LIMIT_PER_HOUR} AI research queries per hour. "
                f"Please wait approximately {minutes_left} minute(s) before trying again."
            )

        return True, None

    def record_run(self, user_id: str, approx_tokens: int = 0, llm_calls: int = 0):
        now = time.time()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Update user timestamps
        if user_id not in self.user_timestamps:
            self.user_timestamps[user_id] = []
        self.user_timestamps[user_id].append(now)

        # Update global daily count
        self.global_daily_counts[today] = self.global_daily_counts.get(today, 0) + 1

        # Update aggregate telemetry
        self.total_runs += 1
        self.total_llm_calls += llm_calls
        self.total_approx_tokens += approx_tokens

    def get_cache_key(self, query: str, post_id: Optional[str] = None, want_image: bool = False) -> str:
        normalized = f"{query.strip().lower()}::{post_id or ''}::{want_image}"
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def get_cached(self, query: str, post_id: Optional[str] = None, want_image: bool = False) -> Optional[Dict[str, Any]]:
        key = self.get_cache_key(query, post_id, want_image)
        if key in self.cache:
            created_at, data = self.cache[key]
            if time.time() - created_at < CACHE_TTL_SECONDS:
                return data
            else:
                del self.cache[key]
        return None

    def set_cached(self, query: str, post_id: Optional[str], want_image: bool, data: Dict[str, Any]):
        key = self.get_cache_key(query, post_id, want_image)
        self.cache[key] = (time.time(), data)

    def reset_for_tests(self):
        """Helper for test suites to ensure clean isolation."""
        self.user_timestamps.clear()
        self.global_daily_counts.clear()
        self.cache.clear()
        self.total_runs = 0
        self.total_llm_calls = 0
        self.total_approx_tokens = 0

cost_guard = CostGuard()

def wrap_untrusted(text: str, tag: str = "untrusted_content") -> str:
    """Wraps untrusted user/web input in strict delimiters to mitigate prompt injection."""
    clean = text.replace(f"<{tag}>", "").replace(f"</{tag}>", "")
    return f"<{tag}>\n{clean}\n</{tag}>"
