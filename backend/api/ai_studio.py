import os
import json
import uuid
from typing import Optional, AsyncGenerator
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from langgraph.types import Command

from backend.models.db import User, get_async_session
from backend.core.users import current_active_user
from backend.agents.graph import research_graph
from backend.agents.rate_limit import (
    cost_guard,
    MAX_QUERY_LENGTH,
    MAX_CRITIQUE_ROUNDS,
    wrap_untrusted
)
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/agent/research", tags=["AI Studio"])

class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=MAX_QUERY_LENGTH)
    post_id: Optional[str] = None
    want_image: bool = False

    @field_validator("query")
    @classmethod
    def clean_query(cls, v: str) -> str:
        cleaned = v.strip()
        if len(cleaned) < 2:
            raise ValueError("Query must be at least 2 characters.")
        if len(cleaned) > MAX_QUERY_LENGTH:
            raise ValueError(f"Query exceeds maximum allowed length of {MAX_QUERY_LENGTH} characters.")
        return cleaned

class ApprovalRequest(BaseModel):
    user_action: str = Field(..., pattern="^(approve|cancel)$")
    edited_text: Optional[str] = Field(None, max_length=2000)
    selected_image_url: Optional[str] = Field(None, max_length=1000)

@router.post("")
async def start_research(
    request: ResearchRequest,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    Initiates an AI Studio research stream.
    Returns a Server-Sent Events (SSE) stream reporting live step-by-step progress,
    self-correction notices, and the final human-in-the-loop comparison result.
    """
    user_id = str(user.id)
    user_name = user.name or "User"

    # 1. Enforce rate limit and daily cap guardrails ($0.00 guarantee)
    allowed, limit_message = cost_guard.check_limits(user_id)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=limit_message
        )

    thread_id = str(uuid.uuid4())
    config = {
        "configurable": {
            "thread_id": thread_id,
            "session": session
        }
    }

    initial_state = {
        "query": request.query,
        "post_id": request.post_id,
        "want_image": request.want_image,
        "user_id": user_id,
        "user_name": user_name,
        "llm_calls": 0,
        "approx_tokens": 0,
        "critique_count": 0
    }

    async def event_generator() -> AsyncGenerator[str, None]:
        approx_tokens_accum = 0
        llm_calls_accum = 0
        last_state = initial_state

        def format_sse(event_name: str, data: dict) -> str:
            return f"event: {event_name}\ndata: {json.dumps(data)}\n\n"

        yield format_sse("step", {
            "name": "retrieve_internal",
            "status": "Reading what people on SocialFeed said about this...",
            "thread_id": thread_id
        })

        try:
            # Stream node updates from LangGraph until pause/interrupt
            async for update in research_graph.astream(initial_state, config=config, stream_mode="updates"):
                for node_name, node_output in update.items():
                    if not isinstance(node_output, dict):
                        continue

                    last_state.update(node_output)
                    approx_tokens_accum = max(approx_tokens_accum, node_output.get("approx_tokens", approx_tokens_accum))
                    llm_calls_accum = max(llm_calls_accum, node_output.get("llm_calls", llm_calls_accum))

                    if node_name == "retrieve_internal":
                        docs = node_output.get("internal_docs", [])
                        count = len(docs)
                        yield format_sse("step", {
                            "name": "grade_documents",
                            "status": f"Found {count} relevant post(s) on SocialFeed. Evaluating completeness...",
                            "partial": {"internal_docs": docs}
                        })

                    elif node_name == "grade_documents":
                        sufficient = node_output.get("internal_answered", False)
                        if sufficient:
                            yield format_sse("step", {
                                "name": "draft",
                                "status": "Community discussions are comprehensive. Drafting synthesis...",
                                "partial": {"internal_answered": True}
                            })
                        else:
                            yield format_sse("step", {
                                "name": "web_search",
                                "status": "Checking the live internet for verified facts & citations...",
                                "partial": {"internal_answered": False}
                            })

                    elif node_name == "web_search":
                        web_docs = node_output.get("web_docs", [])
                        yield format_sse("step", {
                            "name": "draft",
                            "status": f"Retrieved {len(web_docs)} web source(s). Synthesizing Community vs. Reality...",
                            "partial": {"web_docs": web_docs}
                        })

                    elif node_name == "draft":
                        yield format_sse("step", {
                            "name": "critique",
                            "status": "Editor AI reviewing draft for accuracy, balance, and citations...",
                            "partial": {
                                "community_summary": node_output.get("community_summary"),
                                "web_summary": node_output.get("web_summary"),
                                "verdict": node_output.get("verdict"),
                                "draft_post": node_output.get("draft_post")
                            }
                        })

                    elif node_name == "critique":
                        passed = node_output.get("critique_passed", True)
                        count = node_output.get("critique_count", 1)
                        if not passed and count <= MAX_CRITIQUE_ROUNDS:
                            yield format_sse("step", {
                                "name": "draft",
                                "status": f"Self-Correction: Editor AI requested revisions (iteration {count}/2). Rewriting...",
                                "warning": True,
                                "partial": {"critique_feedback": node_output.get("critique_feedback")}
                            })
                        else:
                            if request.want_image:
                                yield format_sse("step", {
                                    "name": "media_director",
                                    "status": "Generating concept visual with Pollinations.ai & Cloudinary..."
                                })
                            else:
                                yield format_sse("step", {
                                    "name": "approval_ready",
                                    "status": "Synthesis verified. Waiting for your review and approval..."
                                })

                    elif node_name == "media_director":
                        yield format_sse("step", {
                            "name": "approval_ready",
                            "status": "Visual generated. Waiting for your review and approval...",
                            "partial": {"image_url": node_output.get("image_url")}
                        })

            # Fetch graph checkpoint state to confirm interrupt payload
            saved_state = await research_graph.aget_state(config)
            interrupt_val = {}
            if saved_state and saved_state.tasks and saved_state.tasks[0].interrupts:
                interrupt_val = saved_state.tasks[0].interrupts[0].value

            comparison_payload = {
                "thread_id": thread_id,
                "query": request.query,
                "community_summary": interrupt_val.get("community_summary") or last_state.get("community_summary"),
                "web_summary": interrupt_val.get("web_summary") or last_state.get("web_summary"),
                "verdict": interrupt_val.get("verdict") or last_state.get("verdict"),
                "draft_post": interrupt_val.get("draft_post") or last_state.get("draft_post"),
                "image_url": interrupt_val.get("image_url") or last_state.get("image_url"),
                "critique_count": last_state.get("critique_count", 0),
                "internal_docs": last_state.get("internal_docs", []),
                "web_docs": last_state.get("web_docs", []),
                "user_id": user_id
            }

            # Record telemetry in cost guard
            cost_guard.record_run(user_id, approx_tokens_accum, llm_calls_accum)

            yield format_sse("approval_ready", comparison_payload)
            yield format_sse("complete", {"thread_id": thread_id, "status": "ready_for_approval"})

        except Exception as e:
            # Friendly error handling - never leak stack traces
            yield format_sse("error", {
                "message": "AI Studio encountered a temporary provider issue. Please try again in a few moments.",
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

@router.post("/{thread_id}/approve")
async def approve_and_publish(
    thread_id: str,
    body: ApprovalRequest,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    Resumes a paused research thread, verifies caller ownership, and publishes the post.
    """
    config = {
        "configurable": {
            "thread_id": thread_id,
            "session": session
        }
    }

    saved_state = await research_graph.aget_state(config)
    if not saved_state or not saved_state.values:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Research session not found or already completed."
        )

    # Security check: verify this thread belongs to the authenticated user
    thread_user_id = saved_state.values.get("user_id")
    if thread_user_id and str(thread_user_id) != str(user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: You cannot approve a research session created by another user."
        )

    if body.user_action != "approve":
        # Cancel action
        await research_graph.ainvoke(Command(resume={"user_action": "cancel"}), config=config)
        return {"message": "Research session cancelled successfully.", "status": "cancelled"}

    # Resume the graph with user edits
    resume_payload = {
        "user_action": "approve",
        "edited_text": body.edited_text,
        "selected_image_url": body.selected_image_url
    }

    result = await research_graph.ainvoke(Command(resume=resume_payload), config=config)
    post_id = result.get("published_post_id")

    if not post_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to publish post to feed."
        )

    return {
        "message": "Post published successfully!",
        "post_id": post_id,
        "status": "published"
    }

@router.post("/{thread_id}/cancel")
async def cancel_research(
    thread_id: str,
    user: User = Depends(current_active_user)
):
    """Cancels a paused research session."""
    config = {"configurable": {"thread_id": thread_id}}
    saved_state = await research_graph.aget_state(config)
    if saved_state and saved_state.values:
        thread_user_id = saved_state.values.get("user_id")
        if thread_user_id and str(thread_user_id) != str(user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden.")

    try:
        await research_graph.ainvoke(Command(resume={"user_action": "cancel"}), config=config)
    except Exception:
        pass

    return {"message": "Research session cancelled.", "status": "cancelled"}
