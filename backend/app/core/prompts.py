from __future__ import annotations

import json


def _trim_text(text: str, max_chars: int = 26000) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n[Transcript truncated for token limits.]"


def build_summary_prompt(transcript: str) -> str:
    transcript = _trim_text(transcript)
    return f"""
You are an expert academic assistant. Create a structured study summary from the lecture transcript.

Return ONLY valid JSON with this exact schema:
{{
  "overview_paragraphs": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "key_definitions": ["string"],
  "core_concepts": ["string"],
  "important_examples": ["string"],
  "exam_revision_points": ["string"]
}}

Rules:
- Exactly 3 overview paragraphs.
- 4 to 8 bullet points per array.
- Keep each bullet concise, academic, and exam-focused.
- Avoid repeating ideas across sections.
- If transcript is noisy, infer the most likely educational intent.

Transcript:
{transcript}
""".strip()


def build_summary_chunk_prompt(chunk_text: str, chunk_index: int, total_chunks: int) -> str:
    return f"""
You are processing lecture chunk {chunk_index} of {total_chunks} for multi-pass summarization.

Use only the chunk content below. Avoid hallucinations.

Return ONLY valid JSON with this exact schema:
{{
  "chunk_title": "string",
  "key_definitions": ["string"],
  "core_concepts": ["string"],
  "important_examples": ["string"],
  "revision_points": ["string"],
  "fact_statements": ["string"]
}}

Rules:
- 2 to 5 items per list.
- fact_statements must be concrete, source-grounded statements.
- Keep output concise and exam-relevant.

Chunk content:
{chunk_text}
""".strip()


def build_summary_reduce_prompt(chunk_notes: list[dict]) -> str:
    payload = json.dumps(chunk_notes, ensure_ascii=True)
    return f"""
You are in reduce stage of a map-reduce lecture summarization pipeline.

Merge the chunk outputs into a coherent consolidated representation.

Return ONLY valid JSON with this exact schema:
{{
  "topic_outline": ["string"],
  "key_definitions": ["string"],
  "core_concepts": ["string"],
  "important_examples": ["string"],
  "exam_revision_points": ["string"],
  "fact_bank": ["string"]
}}

Rules:
- Remove duplicates and weak points.
- Preserve technical accuracy.
- Keep output concise.

Chunk notes JSON:
{payload}
""".strip()


def build_summary_synthesis_prompt(reduced_notes: dict, transcript_excerpt: str) -> str:
    reduced_payload = json.dumps(reduced_notes, ensure_ascii=True)
    excerpt = _trim_text(transcript_excerpt, max_chars=9000)

    return f"""
You are in final synthesis stage of multi-pass summarization.

Use the reduced notes and transcript excerpt to produce final structured output.

Return ONLY valid JSON with this exact schema:
{{
  "overview_paragraphs": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "key_definitions": ["string"],
  "core_concepts": ["string"],
  "important_examples": ["string"],
  "exam_revision_points": ["string"]
}}

Rules:
- Exactly 3 coherent overview paragraphs.
- 4 to 8 items per bullet section.
- No redundancy across sections.
- Keep exam preparation focus.

Reduced notes:
{reduced_payload}

Transcript excerpt:
{excerpt}
""".strip()


def build_summary_validation_prompt(candidate_summary: dict, reduced_notes: dict) -> str:
    candidate_payload = json.dumps(candidate_summary, ensure_ascii=True)
    reduced_payload = json.dumps(reduced_notes, ensure_ascii=True)

    return f"""
Validate and improve this lecture summary for factual consistency and clarity.

Return ONLY valid JSON with this exact schema:
{{
  "overview_paragraphs": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "key_definitions": ["string"],
  "core_concepts": ["string"],
  "important_examples": ["string"],
  "exam_revision_points": ["string"]
}}

Validation checklist:
- Keep exactly 3 overview paragraphs.
- Remove repetitions.
- Keep only claims supported by reduced notes.
- Improve clarity and exam relevance.

Candidate summary:
{candidate_payload}

Reduced notes:
{reduced_payload}
""".strip()


def build_chat_prompt(summary: dict, message: str, history: list[dict], context_chunks: list[str] | None = None) -> str:
    trimmed_history = history[-10:]
    history_text = "\n".join([f"{item['role']}: {item['content']}" for item in trimmed_history])
    context_payload = "\n\n".join(context_chunks or [])

    return f"""
You are brainbyts' contextual tutor chatbot.

Grounding rules:
- Use summary context and retrieved lecture excerpts as primary evidence.
- If a question is outside available context, clearly say it is not in the current notes.
- Keep answer concise, exam-ready, and avoid unsupported claims.

Summary context:
{json.dumps(summary, ensure_ascii=True)}

Retrieved lecture context:
{context_payload}

Recent conversation:
{history_text}

Student question:
{message}

Provide a direct and accurate answer.
""".strip()


def build_mcq_prompt(summary: dict, context_chunks: list[str] | None = None) -> str:
    # Token optimization: prune context payload to avoid token bloat and latency
    pruned_chunks = (context_chunks or [])[:2]
    context_payload = "\n\n".join(pruned_chunks)
    if len(context_payload) > 1500:
        context_payload = context_payload[:1500] + "..."

    summary_compact = {
        "key_definitions": summary.get("key_definitions", [])[:4],
        "core_concepts": summary.get("core_concepts", [])[:4],
        "important_examples": summary.get("important_examples", [])[:3],
        "exam_revision_points": summary.get("exam_revision_points", [])[:3],
    }

    return f"""You are an expert exam question creator. Generate exactly 5 high-quality, exam-grade multiple-choice questions based on the lecture material below.

Return ONLY valid JSON with this exact schema:
{{
  "mcqs": [
    {{
      "question": "Clear, precise academic question testing conceptual understanding or practical application",
      "options": ["Plausible Option A", "Plausible Option B", "Plausible Option C", "Plausible Option D"],
      "correct_index": 0,
      "explanation": "Concise 1-2 sentence explanation stating why the correct answer is right and correcting common misconceptions."
    }}
  ]
}}

Rules:
- Exactly 5 questions covering key concepts across the lecture.
- Exactly 4 plausible, distinct options per question.
- correct_index must be an integer from 0 to 3. Distribute correct indices evenly.
- High pedagogical quality: test conceptual reasoning, problem-solving, and applications.
- Explanations must be educational, factual, and strictly grounded in the lecture.

Lecture Concepts:
{json.dumps(summary_compact, ensure_ascii=True)}

Lecture Context Excerpt:
{context_payload}
""".strip()


def build_solver_chat_prompt(message: str, history: list[dict]) -> str:
    trimmed_history = history[-10:]
    history_text = "\n".join([f"{item['role']}: {item['content']}" for item in trimmed_history])

    return f"""
You are brainbyts Solver Chat, a high-accuracy problem-solving tutor.

Behavior rules:
- Support math, programming, science, and general study questions.
- If an image is provided, use it as primary context.
- Show step-by-step reasoning concisely.
- For math, include formulas and final answer clearly.
- If information is insufficient, ask a precise follow-up question.

Recent conversation:
{history_text}

User request:
{message}
""".strip()
