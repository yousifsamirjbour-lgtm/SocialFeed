from typing import TypedDict, List, Dict, Any, Optional

class AgentState(TypedDict, total=False):
    # Inputs
    query: str
    post_id: Optional[str]
    want_image: bool
    user_id: str
    user_name: str
    
    # Internal retrieval
    internal_docs: List[Dict[str, Any]]
    internal_answered: bool
    internal_reason: Optional[str]
    
    # External research
    web_docs: List[Dict[str, Any]]
    
    # Draft & Community vs Reality synthesis
    community_summary: str
    web_summary: str
    verdict: str  # e.g., "Verified / Supported", "False / Misleading", "Mixed / Nuanced", "Unverified"
    draft_post: str
    
    # Critique & Self-Correction
    critique_feedback: Optional[str]
    critique_passed: bool
    critique_count: int
    
    # Media Generation
    image_prompt: Optional[str]
    image_url: Optional[str]
    
    # Human-in-the-loop Approval & Publishing
    approval_status: Optional[str]  # "pending", "approved", "rejected"
    edited_text: Optional[str]
    selected_image_url: Optional[str]
    published_post_id: Optional[str]
    
    # Telemetry & Cost Tracking
    llm_calls: int
    approx_tokens: int
    error: Optional[str]
