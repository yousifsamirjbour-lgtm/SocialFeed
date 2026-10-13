import pytest
from unittest.mock import AsyncMock, patch, MagicMock

@pytest.mark.asyncio
async def test_search_agent_success(client):
    mock_agent = MagicMock()
    mock_message = MagicMock()
    mock_message.content = "Here is the search result with [Source](https://example.com)."
    mock_agent.ainvoke = AsyncMock(return_value={"messages": [mock_message]})

    with patch("backend.api.search_route.get_search_agent", return_value=mock_agent):
        payload = {"query": "Tell me about AI"}
        res = await client.post("/api/search-agent", json=payload)
        assert res.status_code == 200
        assert res.json() == {"response": "Here is the search result with [Source](https://example.com)."}
        mock_agent.ainvoke.assert_awaited_once_with({"messages": [("user", "Tell me about AI")]})

@pytest.mark.asyncio
async def test_search_agent_failure(client):
    mock_agent = MagicMock()
    mock_agent.ainvoke = AsyncMock(side_effect=RuntimeError("Groq API rate limit exceeded"))

    with patch("backend.api.search_route.get_search_agent", return_value=mock_agent):
        payload = {"query": "Error query"}
        res = await client.post("/api/search-agent", json=payload)
        assert res.status_code == 500
        assert "Groq API rate limit exceeded" in res.json()["detail"]

@pytest.mark.asyncio
async def test_search_agent_validation_error(client):
    res = await client.post("/api/search-agent", json={})
    assert res.status_code == 422

def test_get_search_agent_factory():
    with patch("backend.agents.web_search.TavilySearch") as mock_tavily, \
         patch("backend.agents.web_search.ChatGroq") as mock_groq, \
         patch("backend.agents.web_search.create_react_agent") as mock_create_agent:
        
        mock_create_agent.return_value = "mocked_compiled_agent"
        from backend.agents.web_search import get_search_agent
        agent = get_search_agent()
        assert agent == "mocked_compiled_agent"
        mock_tavily.assert_called_once_with(max_results=3)
        mock_groq.assert_called_once_with(model="openai/gpt-oss-20b", temperature=0)
