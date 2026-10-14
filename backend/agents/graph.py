import os
from typing import Optional, Any
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

from backend.agents.state import AgentState
from backend.agents.nodes import (
    retrieve_internal_node,
    grade_documents_node,
    web_search_node,
    draft_node,
    critique_node,
    media_director_node,
    approval_node,
    publish_node,
)
from backend.agents.rate_limit import MAX_CRITIQUE_ROUNDS

# Global in-memory checkpointer singleton for session continuity across requests
_default_memory_checkpointer = MemorySaver()

def route_after_grading(state: AgentState) -> str:
    """Route to web search only if internal discussions are insufficient."""
    if state.get("internal_answered"):
        return "draft"
    return "web_search"

def route_after_critique(state: AgentState) -> str:
    """Route back to draft if critique failed and within critique limits."""
    passed = state.get("critique_passed", True)
    count = state.get("critique_count", 0)

    if not passed and count < MAX_CRITIQUE_ROUNDS:
        return "draft"

    if state.get("want_image", False):
        return "media_director"

    return "approval"

def build_research_graph(checkpointer: Optional[Any] = None):
    """Build and compile the LangGraph AI Studio research workflow."""
    workflow = StateGraph(AgentState)

    # Add execution nodes
    workflow.add_node("retrieve_internal", retrieve_internal_node)
    workflow.add_node("grade_documents", grade_documents_node)
    workflow.add_node("web_search", web_search_node)
    workflow.add_node("draft", draft_node)
    workflow.add_node("critique", critique_node)
    workflow.add_node("media_director", media_director_node)
    workflow.add_node("approval", approval_node)
    workflow.add_node("publish", publish_node)

    # Add edges
    workflow.add_edge(START, "retrieve_internal")
    workflow.add_edge("retrieve_internal", "grade_documents")

    workflow.add_conditional_edges(
        "grade_documents",
        route_after_grading,
        {
            "draft": "draft",
            "web_search": "web_search"
        }
    )

    workflow.add_edge("web_search", "draft")
    workflow.add_edge("draft", "critique")

    workflow.add_conditional_edges(
        "critique",
        route_after_critique,
        {
            "draft": "draft",
            "media_director": "media_director",
            "approval": "approval"
        }
    )

    workflow.add_edge("media_director", "approval")
    workflow.add_edge("approval", "publish")
    workflow.add_edge("publish", END)

    saver = checkpointer if checkpointer is not None else _default_memory_checkpointer
    return workflow.compile(checkpointer=saver)

# Cached compiled graph instance
research_graph = build_research_graph()
