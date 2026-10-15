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
