import io
import uuid
import pytest
from httpx import AsyncClient
from backend.core.document_parser import (
    extract_text_from_document,
    chunk_document_pages,
    sanitize_filename
)
from backend.agents.hybrid_retriever import PostgresDocumentRetriever
from backend.models.db import DocumentChunk

@pytest.mark.asyncio
async def test_document_parser_txt_and_md():
    content = "Hello world! This is a test document with sample content for testing."
    # TXT
    pages = extract_text_from_document(content.encode("utf-8"), "test.txt")
    assert len(pages) == 1
    assert "Hello world" in pages[0]["text"]

    # MD
    pages_md = extract_text_from_document(b"# Markdown Title\nSome content.", "notes.md")
    assert len(pages_md) == 1
    assert "Markdown Title" in pages_md[0]["text"]

    # Unsupported
    with pytest.raises(ValueError, match="Unsupported file format"):
        extract_text_from_document(b"fake binary", "image.png")

@pytest.mark.asyncio
async def test_chunk_document_pages():
    pages = [{"page": 1, "text": "word " * 120}]
    chunks = chunk_document_pages(pages, chunk_size=50, chunk_overlap=10)
    assert len(chunks) >= 2
    assert chunks[0]["page_number"] == 1
    assert chunks[0]["chunk_index"] == 0

@pytest.mark.asyncio
async def test_sanitize_filename():
    assert sanitize_filename("../../../etc/passwd.txt") == "passwd.txt"
    assert sanitize_filename("my document (1).pdf") == "my document 1.pdf"

@pytest.mark.asyncio
async def test_postgres_document_retriever_sqlite(db_session, test_user):
    session_id = uuid.uuid4()
    c1 = DocumentChunk(
        user_id=test_user.id,
        chat_session_id=session_id,
        filename="ai_report.pdf",
        page_number=1,
        chunk_index=0,
        content="Artificial intelligence and neural networks are transforming technology.",
        embedding=None
    )
    c2 = DocumentChunk(
        user_id=test_user.id,
        chat_session_id=session_id,
        filename="cooking.txt",
        page_number=1,
        chunk_index=0,
        content="Baking bread requires flour, water, yeast, and salt.",
        embedding=None
    )
    db_session.add_all([c1, c2])
    await db_session.commit()

    retriever = PostgresDocumentRetriever()
    results = await retriever.retrieve(
        query="artificial intelligence",
        session=db_session,
        user_id=test_user.id,
        chat_session_id=session_id,
        limit=5
    )
    assert len(results) >= 1
    assert "Artificial intelligence" in results[0]["content"]
    assert results[0]["filename"] == "ai_report.pdf"

@pytest.mark.asyncio
async def test_chat_upload_and_attachments_api(client: AsyncClient, auth_headers: dict):
    chat_session_id = str(uuid.uuid4())

    # 1. Upload a text file
    file_bytes = b"This is the confidential financial report for Q3 2026. Revenue grew by 25%."
    files = {
        "file": ("q3_report.txt", io.BytesIO(file_bytes), "text/plain")
    }
    data = {
        "chat_session_id": chat_session_id
    }

    resp = await client.post("/api/chat/upload", files=files, data=data, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    res_data = resp.json()
    assert res_data["status"] == "success"
    assert res_data["filename"] == "q3_report.txt"
    assert res_data["chunk_count"] >= 1

    # 2. Get attachments
    resp = await client.get(f"/api/chat/attachments/{chat_session_id}", headers=auth_headers)
    assert resp.status_code == 200
    attachments = resp.json()
    assert len(attachments) == 1
    assert attachments[0]["filename"] == "q3_report.txt"

    # 3. Delete single attachment
    resp = await client.delete(f"/api/chat/attachments/{chat_session_id}/q3_report.txt", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "success"

    # Verify empty
    resp = await client.get(f"/api/chat/attachments/{chat_session_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 0

@pytest.mark.asyncio
async def test_route_mode_detection():
    from backend.agents.chat_nodes import route_mode_node
    
    # 1. Standard auto
    s1 = {"query": "What is Python?", "mode": "auto", "doc_count": 0}
    r1 = await route_mode_node(s1)
    assert r1["mode"] == "auto"

    # 2. English phrase trigger
    s2 = {"query": "Tell me the policy from my documents only please", "mode": "auto", "doc_count": 0}
    r2 = await route_mode_node(s2)
    assert r2["mode"] == "docs_only"

    # 3. Arabic phrase trigger
    s3 = {"query": "ما هي الميزانية فقط من المستندات", "mode": "auto", "doc_count": 0}
    r3 = await route_mode_node(s3)
    assert r3["mode"] == "docs_only"

@pytest.mark.asyncio
async def test_conditional_routing_logic():
    from backend.agents.chat_graph import route_after_mode, route_after_grade

    # route_after_mode
    assert route_after_mode({"doc_count": 5, "mode": "auto"}) == "retrieve_docs"
    assert route_after_mode({"doc_count": 5, "mode": "docs_only"}) == "retrieve_docs"
    assert route_after_mode({"doc_count": 0, "mode": "docs_only"}) == "generate_refusal"
    assert route_after_mode({"doc_count": 0, "mode": "auto"}) == "web_search"

    # route_after_grade
    assert route_after_grade({"is_sufficient": True, "mode": "auto"}) == "generate_answer"
    assert route_after_grade({"is_sufficient": True, "mode": "docs_only"}) == "generate_answer"
    assert route_after_grade({"is_sufficient": False, "mode": "docs_only"}) == "generate_refusal"
    assert route_after_grade({"is_sufficient": False, "mode": "auto"}) == "web_search"

@pytest.mark.asyncio
async def test_generate_refusal_node():
    from backend.agents.chat_nodes import generate_refusal_node

    # English 0 docs
    res_en_0 = await generate_refusal_node({"query": "What is our Q3 profit?", "doc_count": 0})
    assert "Docs-Only" in res_en_0["final_answer"]
    assert "no documents are attached" in res_en_0["final_answer"]
    assert res_en_0["sources_used"] == "None"

    # Arabic 0 docs
    res_ar_0 = await generate_refusal_node({"query": "ما هي أرباح الربع الثالث؟", "doc_count": 0})
    assert "المستندات فقط" in res_ar_0["final_answer"]
    assert "لا توجد أي مستندات مرفقة" in res_ar_0["final_answer"]

    # English docs attached but insufficient
    res_en_insuf = await generate_refusal_node({"query": "What is our Q3 profit?", "doc_count": 2})
    assert "do not contain sufficient evidence" in res_en_insuf["final_answer"]
    assert res_en_insuf["sources_used"] == "Documents"

@pytest.mark.asyncio
async def test_stream_chat_endpoint_docs_only_refusal(client: AsyncClient, auth_headers: dict):
    chat_session_id = str(uuid.uuid4())
    req_payload = {
        "query": "Tell me the confidential revenue strictly from documents only",
        "chat_session_id": chat_session_id,
        "mode": "docs_only"
    }

    resp = await client.post("/api/chat/stream", json=req_payload, headers=auth_headers)
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    body = resp.text
    assert "event: step" in body
    assert "event: answer" in body
    assert "event: complete" in body
    assert "Docs-Only" in body

@pytest.mark.asyncio
async def test_reciprocal_rank_fusion_logic():
    from backend.agents.hybrid_retriever import reciprocal_rank_fusion

    fts_list = [
        {"id": "doc1", "filename": "doc1.pdf", "content": "alpha"},
        {"id": "doc2", "filename": "doc2.pdf", "content": "beta"},
        {"id": "doc3", "filename": "doc3.pdf", "content": "gamma"}
    ]
    vec_list = [
        {"id": "doc2", "filename": "doc2.pdf", "content": "beta"},
        {"id": "doc4", "filename": "doc4.pdf", "content": "delta"},
        {"id": "doc1", "filename": "doc1.pdf", "content": "alpha"}
    ]

    fused = reciprocal_rank_fusion(fts_list, vec_list, k=60, top_n=4)
    # doc1 and doc2 appear in both rankings, so their RRF score must be higher than doc3 and doc4
    fused_ids = [item["id"] for item in fused]
    assert len(fused) == 4
    # Both doc1 and doc2 should be at the top
    assert set(fused_ids[:2]) == {"doc1", "doc2"}
    assert fused[0]["score"] > fused[2]["score"]

@pytest.mark.asyncio
async def test_hybrid_retriever_vector_fallback_sqlite(db_session, test_user):
    from backend.agents.hybrid_retriever import PostgresDocumentRetriever

    retriever = PostgresDocumentRetriever()
    session_id = uuid.uuid4()
    # On SQLite dialect, retrieve_vector should gracefully return []
    vec_results = await retriever.retrieve_vector(
        query="test query",
        session=db_session,
        user_id=test_user.id,
        chat_session_id=session_id
    )
    assert vec_results == []

    # And unified retrieve() falls back cleanly to FTS
    c = DocumentChunk(
        user_id=test_user.id,
        chat_session_id=session_id,
        filename="hybrid_test.txt",
        page_number=1,
        chunk_index=0,
        content="Hybrid search combines lexical and semantic information beautifully.",
        embedding=None
    )
    db_session.add(c)
    await db_session.commit()

    unified_results = await retriever.retrieve(
        query="hybrid search",
        session=db_session,
        user_id=test_user.id,
        chat_session_id=session_id,
        limit=5
    )
    assert len(unified_results) >= 1
    assert unified_results[0]["filename"] == "hybrid_test.txt"

@pytest.mark.asyncio
async def test_is_summarization_query_detection():
    from backend.agents.chat_nodes import is_summarization_query

    # English positive cases
    assert is_summarization_query("Summarize key findings from the uploaded document")
    assert is_summarization_query("Can you give me an overview of the report?")
    assert is_summarization_query("What is this document about?")
    assert is_summarization_query("What are the main points and key takeaways?")
    assert is_summarization_query("tl;dr of this file please")
    assert is_summarization_query("Explain this document")

    # Arabic positive cases
    assert is_summarization_query("لخص أهم نتائج المستند المرفق")
    assert is_summarization_query("ملخص التقرير المرفوع")
    assert is_summarization_query("ما هي أهم النقاط في الملف؟")
    assert is_summarization_query("خلاصة البحث وأهم الاستنتاجات")
    assert is_summarization_query("عن ماذا يتحدث هذا المستند؟")

    # Negative cases (specific questions)
    assert not is_summarization_query("What was the exact revenue in 2024?")
    assert not is_summarization_query("Who is the CEO mentioned on page 3?")
    assert not is_summarization_query("كم بلغت الأرباح التشغيلية؟")

@pytest.mark.asyncio
async def test_summarization_query_docs_only_retrieval_and_grading(db_session, test_user):
    from backend.agents.chat_nodes import retrieve_docs_node, grade_relevance_node
    from backend.agents.chat_graph import route_after_grade

    session_id = uuid.uuid4()
    # Add document chunks
    c1 = DocumentChunk(
        user_id=test_user.id,
        chat_session_id=session_id,
        filename="project_proposal.pdf",
        page_number=1,
        chunk_index=0,
        content="Section 1: Background. This project modernizes social feed architecture.",
        embedding=None
    )
    c2 = DocumentChunk(
        user_id=test_user.id,
        chat_session_id=session_id,
        filename="project_proposal.pdf",
        page_number=2,
        chunk_index=1,
        content="Section 2: Goals. Primary goal is zero latency streaming and hybrid search.",
        embedding=None
    )
    db_session.add_all([c1, c2])
    await db_session.commit()

    # Query for summary in docs_only mode
    state = {
        "query": "Summarize key findings from the uploaded document",
        "mode": "docs_only",
        "user_id": str(test_user.id),
        "chat_session_id": str(session_id),
        "doc_count": 2
    }
    config = {"configurable": {"session": db_session}}

    retrieval_res = await retrieve_docs_node(state, config=config)
    assert len(retrieval_res["retrieved_docs"]) >= 2
    assert retrieval_res["retrieved_docs"][0]["filename"] == "project_proposal.pdf"

    state.update(retrieval_res)
    grade_res = await grade_relevance_node(state)
    assert grade_res["is_sufficient"] is True
    assert "Document summarization/overview request" in grade_res["grade_reason"]

    # Verify route_after_grade chooses generate_answer instead of generate_refusal
    state.update(grade_res)
    next_node = route_after_grade(state)
    assert next_node == "generate_answer"

@pytest.mark.asyncio
async def test_gemini_embeddings_model_configuration():
    from backend.agents.hybrid_retriever import get_embeddings_model

    model = get_embeddings_model()
    if model:
        assert model.model == "models/gemini-embedding-001"
        assert model.output_dimensionality == 768

@pytest.mark.asyncio
async def test_multiturn_state_and_prompt_assembly(monkeypatch):
    from unittest.mock import AsyncMock
    from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
    from backend.agents.chat_nodes import generate_answer_node

    captured_messages = []

    class MockChatGroq:
        def __init__(self, **kwargs):
            pass
        async def ainvoke(self, messages, **kwargs):
            nonlocal captured_messages
            captured_messages = messages
            return AIMessage(content="You told me your name is Alice.")

    import backend.agents.chat_nodes as cn
    monkeypatch.setattr(cn, "get_groq_llm", lambda **kwargs: MockChatGroq())

    prior_history = [
        HumanMessage(content="Hello! My name is Alice."),
        AIMessage(content="Nice to meet you, Alice!"),
        HumanMessage(content="What did I just say?"),  # current query in state messages
    ]

    state = {
        "query": "What did I just say?",
        "messages": prior_history,
        "retrieved_docs": [],
        "web_docs": [],
        "is_sufficient": True,
        "sources_used": "None"
    }

    res = await generate_answer_node(state)
    assert res["final_answer"] == "You told me your name is Alice."
    assert len(res["messages"]) == 1
    assert isinstance(res["messages"][0], AIMessage)

    # Validate message structure sent to LLM
    assert len(captured_messages) == 4
    assert isinstance(captured_messages[0], SystemMessage)
    assert isinstance(captured_messages[1], HumanMessage)
    assert captured_messages[1].content == "Hello! My name is Alice."
    assert isinstance(captured_messages[2], AIMessage)
    assert captured_messages[2].content == "Nice to meet you, Alice!"
    assert isinstance(captured_messages[3], HumanMessage)
    assert "User Question: What did I just say?" in captured_messages[3].content

@pytest.mark.asyncio
async def test_web_search_fallback_ignores_irrelevant_docs(monkeypatch):
    from langchain_core.messages import AIMessage
    from backend.agents.chat_nodes import web_search_node, generate_answer_node

    captured_prompt = ""

    class MockChatGroq:
        def __init__(self, **kwargs):
            pass
        async def ainvoke(self, messages, **kwargs):
            nonlocal captured_prompt
            captured_prompt = messages[-1].content
    class MockTavilySearch:
        def __init__(self, **kwargs):
            pass
        async def ainvoke(self, query):
            return [
                {"title": "Tokyo Weather", "url": "https://weather.com/tokyo", "content": "Current weather is 22C and sunny."}
            ]

    import backend.agents.chat_nodes as cn
    monkeypatch.setattr(cn, "get_groq_llm", lambda **kwargs: MockChatGroq())
    monkeypatch.setattr(cn, "TavilySearch", MockTavilySearch)

    # State where docs were retrieved but evaluated as irrelevant (is_sufficient = False)
    state = {
        "query": "What is the weather in Tokyo?",
        "retrieved_docs": [
            {"filename": "company_handbook.pdf", "page_number": 1, "chunk_index": 0, "content": "Company vacation policy."}
        ],
        "is_sufficient": False,
        "web_docs": []
    }

    # 1. web_search_node should set sources_used to "Web", NOT "Documents + Web"
    ws_res = await web_search_node(state)
    assert ws_res["sources_used"] == "Web"

    state.update(ws_res)

    # 2. generate_answer_node should NOT inject company_handbook.pdf into context
    ans_res = await generate_answer_node(state)
    assert ans_res["sources_used"] == "Web"
    assert "company_handbook.pdf" not in captured_prompt
    assert "Company vacation policy" not in captured_prompt
    assert "Tokyo Weather" in captured_prompt
    assert len(ans_res["citations"]) == 1
    assert ans_res["citations"][0]["type"] == "web"
    assert ans_res["citations"][0]["url"] == "https://weather.com/tokyo"

@pytest.mark.asyncio
async def test_semantic_chunking_paragraphs_and_arabic():
    from backend.core.document_parser import chunk_document_pages

    doc_text = (
        "الفقرة الأولى تتحدث عن الذكاء الاصطناعي وتطوره السريع في العالم.\n\n"
        "الفقرة الثانية تتناول معالجة اللغات الطبيعية وخاصة اللغة العربية ودقتها؟ وكيف تتكامل مع محركات البحث.\n\n"
        "الفقرة الثالثة تلخص النتائج والتوصيات المستقبلية لهذا البحث."
    )

    pages = [{"page": 1, "text": doc_text}]
    chunks = chunk_document_pages(pages, chunk_size=30, chunk_overlap=5)

    assert len(chunks) >= 1
    full_combined = " ".join([c["content"] for c in chunks])
    assert "الذكاء الاصطناعي" in full_combined
    assert "اللغة العربية" in full_combined
    assert "النتائج والتوصيات" in full_combined





