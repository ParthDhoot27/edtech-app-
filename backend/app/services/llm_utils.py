from __future__ import annotations

import json
import re
from typing import Any

from app.models.schemas import MCQItem, StructuredSummary


def extract_json_payload(text: str) -> Any:
    fenced = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, flags=re.DOTALL)
    candidate = fenced.group(1) if fenced else text

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        object_match = re.search(r"(\{.*\})", candidate, flags=re.DOTALL)
        array_match = re.search(r"(\[.*\])", candidate, flags=re.DOTALL)
        payload = object_match.group(1) if object_match else array_match.group(1) if array_match else ""
        if not payload:
            raise
        return json.loads(payload)


def _format_point(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return "\n".join(point for item in value if (point := _format_point(item)))
    if isinstance(value, dict):
        lines = []
        for key, item in value.items():
            label = re.sub(r"[_-]+", " ", str(key)).title()
            formatted_item = _format_point(item)
            if formatted_item:
                lines.append(f"{label}: {formatted_item}")
        return "\n".join(lines)
    return ""


def clean_points(value: Any) -> list[str]:
    if isinstance(value, list):
        return [point for item in value if (point := _format_point(item))]

    if isinstance(value, str):
        return [chunk.strip(" -") for chunk in value.split("\n") if chunk.strip()]

    if isinstance(value, dict):
        point = _format_point(value)
        return [point] if point else []

    return []


def normalize_summary(data: dict[str, Any]) -> StructuredSummary:
    overview = (
        data.get("overview_paragraphs")
        or data.get("three_paragraph_summary")
        or data.get("summary_paragraphs")
        or data.get("lecture_overview")
        or []
    )

    return StructuredSummary(
        overview_paragraphs=clean_points(overview),
        key_definitions=clean_points(data.get("key_definitions", [])),
        core_concepts=clean_points(data.get("core_concepts", [])),
        important_examples=clean_points(data.get("important_examples", [])),
        exam_revision_points=clean_points(data.get("exam_revision_points", [])),
    )


def normalize_mcq_item(item: dict[str, Any]) -> MCQItem:
    options = [str(opt).strip() for opt in item.get("options", []) if str(opt).strip()]
    options = options[:4]

    if len(options) < 4:
        raise ValueError("MCQ item does not contain four valid options.")

    raw_correct = item.get("correct_index", 0)
    if isinstance(raw_correct, str):
        raw_correct = raw_correct.strip().upper()
        if raw_correct in {"A", "B", "C", "D"}:
            raw_correct = {"A": 0, "B": 1, "C": 2, "D": 3}[raw_correct]
        else:
            raw_correct = int(raw_correct) if raw_correct.isdigit() else 0

    correct_index = max(0, min(int(raw_correct), 3))

    question = str(item.get("question", "")).strip()
    explanation = str(item.get("explanation", "")).strip()
    if not question or not explanation:
        raise ValueError("MCQ item is missing a question or explanation.")

    return MCQItem(
        question=question,
        options=options,
        correct_index=correct_index,
        explanation=explanation,
    )
