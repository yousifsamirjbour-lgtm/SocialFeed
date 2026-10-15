import io
import re
from typing import List, Dict, Any, Optional
import pypdf
import docx

MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024  # 25MB
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}

import os

def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent directory traversal and remove unsafe chars."""
    base = os.path.basename(filename.replace("\\", "/"))
    clean = re.sub(r"[^\w\s\.\-]", "", base).strip()
    clean = clean.lstrip(".")
    return clean[:255] or "document"

def extract_text_from_document(file_bytes: bytes, filename: str) -> List[Dict[str, Any]]:
    """
    Extracts text from PDF, DOCX, TXT, or MD file bytes.
    Returns a list of dicts: [{"page": int, "text": str}]
    """
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File size exceeds maximum allowed limit of {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB.")

    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file format '{ext}'. Supported formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    pages: List[Dict[str, Any]] = []

    if ext == ".pdf":
        try:
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            for idx, page in enumerate(reader.pages):
                text = page.extract_text() or ""
                if text.strip():
                    pages.append({"page": idx + 1, "text": text.strip()})
        except Exception as e:
            raise ValueError(f"Failed to parse PDF document: {str(e)}")

    elif ext == ".docx":
        try:
            doc = docx.Document(io.BytesIO(file_bytes))
            paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
            full_text = "\n\n".join(paragraphs)
            if full_text:
                pages.append({"page": 1, "text": full_text})
        except Exception as e:
            raise ValueError(f"Failed to parse DOCX document: {str(e)}")

    elif ext in {".txt", ".md"}:
        try:
            text = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = file_bytes.decode("latin-1")
            except Exception as e:
                raise ValueError(f"Unable to decode text file: {str(e)}")
        if text.strip():
            pages.append({"page": 1, "text": text.strip()})

    return pages

def chunk_document_pages(
    pages: List[Dict[str, Any]],
    chunk_size: int = 500,
    chunk_overlap: int = 50
) -> List[Dict[str, Any]]:
    """
    Splits extracted pages into chunks of approximately ~chunk_size words/tokens
    with ~chunk_overlap word overlap.
    Returns: [{"chunk_index": int, "page_number": Optional[int], "content": str}]
    """
    chunks: List[Dict[str, Any]] = []
    chunk_index = 0

    for page in pages:
        page_num = page.get("page")
        text = page.get("text", "")
        if not text:
            continue

        words = text.split()
        if not words:
            continue

        step = max(1, chunk_size - chunk_overlap)
        for i in range(0, len(words), step):
            chunk_words = words[i : i + chunk_size]
            content = " ".join(chunk_words).strip()
            if len(content) > 10:  # Skip trivial fragments
                chunks.append({
                    "chunk_index": chunk_index,
                    "page_number": page_num,
                    "content": content
                })
                chunk_index += 1

    return chunks
