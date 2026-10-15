from typing import TypedDict, List, Dict, Any, Optional, Annotated
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

class ChatAgentState(TypedDict):
    """
    State for the AI Studio Hybrid RAG Chat Agent.
    """
    messages: Annotated[List[BaseMessage], add_messages]
    query: str
    mode: str  # "auto" or "docs_only"
    user_id: str
    chat_session_id: str
    doc_count: int
    retrieved_docs: List[Dict[str, Any]]
    is_sufficient: bool
    grade_reason: Optional[str]
    web_docs: List[Dict[str, Any]]
    sources_used: str  # "Documents", "Web", "Documents + Web", "None"
    citations: List[Dict[str, Any]]
    final_answer: str
