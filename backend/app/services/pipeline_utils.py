from __future__ import annotations

import re
from collections import Counter
from typing import Iterable

from app.models.schemas import StructuredSummary

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "being",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "into",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "that",
    "the",
    "their",
    "there",
    "this",
    "to",
    "was",
    "were",
    "with",
    "you",
    "your",
    "we",
    "they",
    "them",
    "our",
    "can",
    "could",
    "would",
    "should",
    "may",
    "might",
    "not",
    "than",
    "then",
    "also",
    "about",
    "such",
    "using",
    "used",
    "use",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "how",
    "if",
    "while",
    "during",
    "before",
    "after",
    "over",
    "under",
}


def clean_transcript_text(text: str, max_chars: int = 120000) -> str:
    value = (text or "").strip()
    if not value:
        return ""

    value = re.sub(r"\b\d{1,2}:\d{2}(?::\d{2})?\b", " ", value)
    value = re.sub(r"\[[^\]]{1,40}\]", " ", value)
    value = re.sub(r"\([^\)]{1,40}\)", " ", value)
    value = re.sub(r"(?m)^[A-Z][A-Z\s]{2,20}:\s*", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) > max_chars:
        value = value[:max_chars] + " [Transcript truncated]"
    return value


def split_sentences(text: str) -> list[str]:
    chunks = re.split(r"(?<=[.!?])\s+|\n+", text)
    output: list[str] = []
    for chunk in chunks:
        item = re.sub(r"\s+", " ", chunk).strip()
        if len(item) < 18:
            continue
        output.append(item)
    return output


def split_into_chunks(
    text: str,
    max_chars: int = 2600,
    overlap_chars: int = 220,
    max_chunks: int = 12,
) -> list[str]:
    cleaned = clean_transcript_text(text)
    if not cleaned:
        return []

    paragraphs = [part.strip() for part in re.split(r"\n{2,}", cleaned) if part.strip()]
    if not paragraphs:
        paragraphs = split_sentences(cleaned)

    chunks: list[str] = []
    current = ""

    for part in paragraphs:
        candidate = f"{current}\n{part}".strip() if current else part
        if len(candidate) <= max_chars:
            current = candidate
            continue

        if current:
            chunks.append(current.strip())
            if len(chunks) >= max_chunks:
                break
            overlap = current[-overlap_chars:] if overlap_chars > 0 else ""
            current = f"{overlap}\n{part}".strip()
        else:
            hard_slice = part[:max_chars]
            chunks.append(hard_slice.strip())
            if len(chunks) >= max_chunks:
                break
            current = part[max_chars - overlap_chars :].strip()

    if current and len(chunks) < max_chunks:
        chunks.append(current.strip())

    return [chunk for chunk in chunks if chunk]


def tokenize_words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z0-9'-]{2,}", (text or "").lower())


def dedupe_strings(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        value = re.sub(r"\s+", " ", (item or "")).strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(value)
    return output


def select_top_chunks_for_query(query: str, chunks: list[str], top_k: int = 4) -> list[str]:
    if not chunks:
        return []

    query_tokens = [token for token in tokenize_words(query) if token not in STOPWORDS]
    if not query_tokens:
        return chunks[:top_k]

    query_counter = Counter(query_tokens)
    ranked: list[tuple[float, str]] = []

    for chunk in chunks:
        chunk_tokens = [token for token in tokenize_words(chunk) if token not in STOPWORDS]
        if not chunk_tokens:
            continue
        chunk_counter = Counter(chunk_tokens)
        overlap = set(query_counter) & set(chunk_counter)
        lexical_score = sum(min(query_counter[token], chunk_counter[token]) for token in overlap)
        length_penalty = 0.00015 * max(0, len(chunk) - 1100)
        score = lexical_score - length_penalty
        if score > 0:
            ranked.append((score, chunk))

    if not ranked:
        return chunks[:top_k]

    ranked.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in ranked[:top_k]]


def build_query_from_summary(summary: StructuredSummary) -> str:
    seeds = (
        summary.core_concepts[:4]
        + summary.exam_revision_points[:3]
        + summary.key_definitions[:3]
    )
    return " ".join(seeds).strip()


def _shorten(text: str, max_chars: int = 190) -> str:
    value = re.sub(r"\s+", " ", (text or "")).strip()
    if len(value) <= max_chars:
        return value
    return value[:max_chars].rsplit(" ", 1)[0] + "..."


def _ensure_item_range(items: list[str], label: str, min_items: int = 4, max_items: int = 8) -> list[str]:
    del label
    del min_items
    del max_items
    return [item for item in dedupe_strings(items) if len(item.strip()) > 8]


def build_source_overview(source_text: str, concepts: list[str]) -> list[str]:
    sentences = dedupe_strings(split_sentences(source_text))
    if not sentences:
        return dedupe_strings(concepts)

    return [
        " ".join(sentences[index : index + 4])
        for index in range(0, len(sentences), 4)
    ]


def validate_structured_summary(summary: StructuredSummary, source_text: str) -> StructuredSummary:
    validated = StructuredSummary(
        overview_paragraphs=dedupe_strings(summary.overview_paragraphs),
        key_definitions=_ensure_item_range(summary.key_definitions, "Definition"),
        core_concepts=_ensure_item_range(summary.core_concepts, "Concept"),
        important_examples=_ensure_item_range(summary.important_examples, "Example"),
        exam_revision_points=_ensure_item_range(summary.exam_revision_points, "Revision Point"),
    )
    return validated
