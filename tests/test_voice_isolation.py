import sys
import inspect
import pytest
from httpx import AsyncClient

import backend.services.voice.stt as v_stt
import backend.services.voice.llm as v_llm
import backend.services.voice.tts as v_tts
import backend.services.voice.session_manager as v_mgr
import backend.api.voice as v_api

def test_voice_module_has_zero_rag_dependencies():
    """
    Verifies architectural isolation: Voice service and API modules must NEVER import
    or depend on LangGraph RAG agents, document chunks, or vector retrievers.
    """
    forbidden_modules = [
        "backend.agents.chat_graph",
        "backend.agents.chat_nodes",
        "backend.agents.chat_state",
        "backend.agents.hybrid_retriever",
        "backend.agents.retriever",
        "backend.agents.web_search"
    ]

    voice_modules = [v_stt, v_llm, v_tts, v_mgr, v_api]

    for mod in voice_modules:
        source = inspect.getsource(mod)
        for forbidden in forbidden_modules:
            assert forbidden not in source, f"Isolation violation: {mod.__name__} imports {forbidden}"
            short_name = forbidden.split(".")[-1]
            assert f"from {forbidden}" not in source, f"Isolation violation: {mod.__name__} imports from {forbidden}"

def test_voice_mode_runs_without_document_chunk_table():
    """
    Verifies that VoiceSession and VoiceSessionRegistry operate purely in-memory
    and against VoiceDailyQuota, with zero reliance on DocumentChunk.
    """
    assert "DocumentChunk" not in inspect.getsource(v_mgr)
    assert "DocumentChunk" not in inspect.getsource(v_api)

@pytest.mark.asyncio
async def test_hybrid_rag_unaffected_by_voice_mode(client: AsyncClient, auth_headers: dict):
    """
    Verifies that the existing hybrid RAG attachment endpoints operate
    completely normally alongside the voice mode modules.
    """
    import uuid
    dummy_session = str(uuid.uuid4())
    resp = await client.get(f"/api/chat/attachments/{dummy_session}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []
