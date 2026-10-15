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


