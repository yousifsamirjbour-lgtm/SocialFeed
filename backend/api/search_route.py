# api/search_route.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.agents.web_search import get_search_agent
router = APIRouter()

class AgentQuery(BaseModel):
    query: str

@router.post("/search-agent")
async def ai_search(request: AgentQuery):
    try:
        agent_executor = get_search_agent()
        
        result = await agent_executor.ainvoke(
            {"messages": [("user", request.query)]}
        )
        
        return {"response": result["messages"][-1].content}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))