from typing import Optional, Any
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

from backend.agents.chat_state import ChatAgentState
from backend.agents.chat_nodes import (
    route_mode_node,
    retrieve_docs_node,
    grade_relevance_node,
    web_search_node,
    generate_answer_node,
    generate_refusal_node
)

_default_chat_checkpointer = MemorySaver()

def route_after_mode(state: ChatAgentState) -> str:
    """
    After routing mode and counting docs:
    - If docs exist, always search them first.
    - If no docs exist and in docs-only mode, jump to refusal.
    - If no docs exist and in auto mode, search the web.
    """
    doc_count = state.get("doc_count", 0)
    mode = state.get("mode", "auto")

    if doc_count > 0:
        return "retrieve_docs"
    if mode == "docs_only":
        return "generate_refusal"
    return "web_search"

def route_after_grade(state: ChatAgentState) -> str:
    """
    After grading retrieved document relevance:
    - If sufficient evidence, generate answer immediately.
    - If insufficient and in docs-only mode, jump to refusal (never web).
    - If insufficient and in auto mode, search the web for missing facts.
    """
    is_sufficient = state.get("is_sufficient", False)
    mode = state.get("mode", "auto")

    if is_sufficient:
        return "generate_answer"
    if mode == "docs_only":
        return "generate_refusal"
    return "web_search"

def build_chat_graph(checkpointer: Optional[Any] = None):
    """
    Builds and compiles the Hybrid RAG Chat LangGraph workflow.
    """
    workflow = StateGraph(ChatAgentState)

    # 1. Add nodes
    workflow.add_node("route_mode", route_mode_node)
    workflow.add_node("retrieve_docs", retrieve_docs_node)
    workflow.add_node("grade_relevance", grade_relevance_node)
    workflow.add_node("web_search", web_search_node)
    workflow.add_node("generate_answer", generate_answer_node)
    workflow.add_node("generate_refusal", generate_refusal_node)

    # 2. Add edges
    workflow.add_edge(START, "route_mode")

    workflow.add_conditional_edges(
        "route_mode",
        route_after_mode,
        {
            "retrieve_docs": "retrieve_docs",
            "generate_refusal": "generate_refusal",
            "web_search": "web_search"
        }
    )

    workflow.add_edge("retrieve_docs", "grade_relevance")

    workflow.add_conditional_edges(
        "grade_relevance",
        route_after_grade,
        {
            "generate_answer": "generate_answer",
            "generate_refusal": "generate_refusal",
            "web_search": "web_search"
        }
    )

    workflow.add_edge("web_search", "generate_answer")
    workflow.add_edge("generate_answer", END)
    workflow.add_edge("generate_refusal", END)

    saver = checkpointer if checkpointer is not None else _default_chat_checkpointer
    return workflow.compile(checkpointer=saver)

chat_graph = build_chat_graph()
