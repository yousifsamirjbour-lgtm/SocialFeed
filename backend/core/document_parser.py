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

def is_arabic_text(text: str) -> bool:
    """Checks if a string contains Arabic characters."""
    return bool(re.search(r"[\u0600-\u06FF]", text or ""))

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
    Splits extracted pages into semantic chunks respecting paragraph and sentence
    boundaries where possible, falling back to word sliding windows for monolithic text.
    Returns: [{"chunk_index": int, "page_number": Optional[int], "content": str}]
    """
    chunks: List[Dict[str, Any]] = []
    chunk_index = 0

    for page in pages:
        page_num = page.get("page")
        text = page.get("text", "")
        if not text or not text.strip():
            continue

        raw_paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
        if not raw_paragraphs:
            raw_paragraphs = [text.strip()]

        current_chunk_words: List[str] = []

        def flush_current_chunk():
            nonlocal chunk_index, current_chunk_words
            if not current_chunk_words:
                return
            content = " ".join(current_chunk_words).strip()
            if len(content) > 10:
                chunks.append({
                    "chunk_index": chunk_index,
                    "page_number": page_num,
                    "content": content
                })
                chunk_index += 1
            if chunk_overlap > 0 and len(current_chunk_words) > chunk_overlap:
                current_chunk_words = current_chunk_words[-chunk_overlap:]
            else:
                current_chunk_words = []

        for para in raw_paragraphs:
            para_words = para.split()
            if not para_words:
                continue

            if len(para_words) > chunk_size:
                flush_current_chunk()
                sentences = [s.strip() for s in re.split(r'(?<=[.!?؟\n])\s+', para) if s.strip()]
                for sentence in sentences:
                    sent_words = sentence.split()
                    if not sent_words:
                        continue
                    if len(sent_words) > chunk_size:
                        flush_current_chunk()
                        step = max(1, chunk_size - chunk_overlap)
                        for i in range(0, len(sent_words), step):
                            slice_words = sent_words[i : i + chunk_size]
                            slice_content = " ".join(slice_words).strip()
                            if len(slice_content) > 10:
                                chunks.append({
                                    "chunk_index": chunk_index,
                                    "page_number": page_num,
                                    "content": slice_content
                                })
                                chunk_index += 1
                    elif len(current_chunk_words) + len(sent_words) > chunk_size:
                        flush_current_chunk()
                        current_chunk_words.extend(sent_words)
                    else:
                        current_chunk_words.extend(sent_words)
            elif len(current_chunk_words) + len(para_words) > chunk_size:
                flush_current_chunk()
                current_chunk_words.extend(para_words)
            else:
                current_chunk_words.extend(para_words)

        flush_current_chunk()

    return chunks
