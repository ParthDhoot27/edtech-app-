from __future__ import annotations

import json
from typing import Any
import logging

from google.api_core.retry import Retry
import google.generativeai as genai

from app.core.prompts import (
    build_chat_prompt,
    build_mcq_prompt,
    build_solver_chat_prompt,
    build_summary_chunk_prompt,
    build_summary_prompt,
    build_summary_reduce_prompt,
    build_summary_synthesis_prompt,
    build_summary_validation_prompt,
)
from app.models.schemas import ChatMessage, MCQItem, StructuredSummary
from app.services.llm_utils import extract_json_payload, normalize_mcq_item, normalize_summary
from app.services.pipeline_utils import clean_transcript_text, split_into_chunks, validate_structured_summary

logger = logging.getLogger(__name__)

SINGLE_PASS_SUMMARY_MAX_CHARS = 7000
SINGLE_PASS_SUMMARY_MAX_CHUNKS = 2

REQUEST_TIMEOUT_SECONDS = 45.0
STRICT_RETRY = Retry(initial=1.0, maximum=2.0, multiplier=1.5, timeout=REQUEST_TIMEOUT_SECONDS)
DEFAULT_GEMINI_MODEL = "models/gemini-3.8-flash"
SUPPORTED_FALLBACK_MODELS = [
    "models/gemini-3.8-flash",
    "models/gemini-3.5-flash",
    "models/gemini-flash-latest",
]


def _normalize_gemini_model_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        return DEFAULT_GEMINI_MODEL
    # Catch discontinued legacy model identifiers
    if any(legacy in cleaned for legacy in ("2.5-flash", "1.5-flash", "2.0-flash")):
        return DEFAULT_GEMINI_MODEL
    if not cleaned.startswith("models/") and not cleaned.startswith("tunedModels/"):
        return f"models/{cleaned}"
    return cleaned


class GeminiService:
    def __init__(self, api_key: str, model_name: str) -> None:
        if not api_key:
            raise ValueError("GEMINI_API_KEY is missing.")

        genai.configure(api_key=api_key)
        self._model_name = _normalize_gemini_model_name(model_name)
        self._model = genai.GenerativeModel(model_name=self._model_name)
        self.last_token_usage: dict[str, int] = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        }

    def _record_token_usage(self, response: Any) -> None:
        usage = getattr(response, "usage_metadata", None)
        if usage:
            p_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
            c_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)
            t_tokens = int(getattr(usage, "total_token_count", 0) or (p_tokens + c_tokens))
            self.last_token_usage = {
                "prompt_tokens": p_tokens,
                "completion_tokens": c_tokens,
                "total_tokens": t_tokens,
            }
            logger.info(
                "Gemini [%s] token usage: prompt=%d, candidates=%d, total=%d",
                self._model_name, p_tokens, c_tokens, t_tokens,
            )

    def _generate(
        self,
        prompt: str,
        temperature: float = 0.2,
        response_mime_type: str | None = None,
        max_output_tokens: int | None = None,
    ) -> str:
        gen_config: dict[str, Any] = {
            "temperature": temperature,
            "top_p": 0.9,
        }
        if response_mime_type:
            gen_config["response_mime_type"] = response_mime_type
        if max_output_tokens:
            gen_config["max_output_tokens"] = max_output_tokens

        try:
            response = self._model.generate_content(
                prompt,
                generation_config=gen_config,
                request_options={"timeout": REQUEST_TIMEOUT_SECONDS, "retry": STRICT_RETRY},
            )
            self._record_token_usage(response)
        except Exception as exc:
            err_msg = str(exc).lower()
            # If model is 404/not supported, 429 quota exhausted, or 503 unavailable / 504 deadline expired
            is_recoverable_failover = any(
                k in err_msg for k in (
                    "not found", "404", "not supported", "503", "unavailable",
                    "high demand", "deadline", "timed out", "timeout", "quota", "429", "resource_exhausted"
                )
            )
            if is_recoverable_failover:
                for fallback_model in SUPPORTED_FALLBACK_MODELS:
                    if fallback_model != self._model_name:
                        try:
                            logger.info("Attempting Gemini model failover from %s to %s", self._model_name, fallback_model)
                            alt_model = genai.GenerativeModel(model_name=fallback_model)
                            response = alt_model.generate_content(
                                prompt,
                                generation_config=gen_config,
                                request_options={"timeout": REQUEST_TIMEOUT_SECONDS, "retry": STRICT_RETRY},
                            )
                            text = getattr(response, "text", "")
                            if text:
                                self._model = alt_model
                                self._model_name = fallback_model
                                self._record_token_usage(response)
                                return text.strip()
                        except Exception:
                            continue
            raise RuntimeError(f"Gemini request failed ({self._model_name}): {exc}") from exc

        text = getattr(response, "text", "")
        if text:
            return text.strip()

        raise RuntimeError(f"Gemini ({self._model_name}) returned an empty response.")

    def _generate_multimodal(self, parts: list[Any], temperature: float = 0.3) -> str:
        try:
            response = self._model.generate_content(
                parts,
                generation_config={
                    "temperature": temperature,
                    "top_p": 0.9,
                },
                request_options={"timeout": REQUEST_TIMEOUT_SECONDS, "retry": STRICT_RETRY},
            )
            self._record_token_usage(response)
        except Exception as exc:
            raise RuntimeError(f"Gemini request failed: {exc}") from exc

        text = getattr(response, "text", "")
        if text:
            return text.strip()

        raise RuntimeError("Gemini returned an empty response.")

    def _generate_json(
        self,
        prompt: str,
        temperature: float = 0.2,
        max_output_tokens: int | None = 2000,
    ) -> Any:
        response_text = self._generate(
            prompt=prompt,
            temperature=temperature,
            response_mime_type="application/json",
            max_output_tokens=max_output_tokens,
        )
        try:
            return extract_json_payload(response_text)
        except json.JSONDecodeError:
            retry_prompt = (
                prompt
                + "\n\nYour previous response was not valid JSON. Return exactly one valid JSON object "
                + "matching the schema above. Do not include markdown or commentary."
            )
            retry_text = self._generate(
                prompt=retry_prompt,
                temperature=max(0.1, temperature - 0.1),
                response_mime_type="application/json",
                max_output_tokens=max_output_tokens,
            )
            try:
                return extract_json_payload(retry_text)
            except json.JSONDecodeError as exc:
                logger.warning("Gemini returned invalid JSON after structured-output retry: %s", exc)
                raise RuntimeError(
                    "Gemini returned an invalid structured response after retry. "
                    "Please try again or use a shorter transcript."
                ) from exc

    def _multi_pass_summary(self, transcript: str) -> dict[str, Any]:
        cleaned = clean_transcript_text(transcript)
        chunks = split_into_chunks(cleaned, max_chars=2500, overlap_chars=240, max_chunks=10)

        if (
            not chunks
            or len(cleaned) <= SINGLE_PASS_SUMMARY_MAX_CHARS
            or len(chunks) <= SINGLE_PASS_SUMMARY_MAX_CHUNKS
        ):
            data = self._generate_json(build_summary_prompt(cleaned), temperature=0.2)
            return data if isinstance(data, dict) else {}

        chunk_notes: list[dict[str, Any]] = []
        for index, chunk in enumerate(chunks, start=1):
            chunk_prompt = build_summary_chunk_prompt(
                chunk_text=chunk,
                chunk_index=index,
                total_chunks=len(chunks),
            )
            chunk_data = self._generate_json(chunk_prompt, temperature=0.2)
            if isinstance(chunk_data, dict):
                chunk_notes.append(chunk_data)

        if not chunk_notes:
            fallback = self._generate_json(build_summary_prompt(cleaned), temperature=0.2)
            return fallback if isinstance(fallback, dict) else {}

        reduced_data = self._generate_json(build_summary_reduce_prompt(chunk_notes), temperature=0.2)
        reduced = reduced_data if isinstance(reduced_data, dict) else {
            "key_definitions": [],
            "core_concepts": [],
            "important_examples": [],
            "exam_revision_points": [],
            "fact_bank": [],
        }

        synthesis = self._generate_json(
            build_summary_synthesis_prompt(
                reduced_notes=reduced,
                transcript_excerpt=cleaned,
            ),
            temperature=0.2,
        )
        candidate = synthesis if isinstance(synthesis, dict) else reduced

        validation = self._generate_json(
            build_summary_validation_prompt(candidate_summary=candidate, reduced_notes=reduced),
            temperature=0.1,
        )
        validated = validation if isinstance(validation, dict) else candidate
        return validated

    def summarize(self, transcript: str) -> StructuredSummary:
        cleaned = clean_transcript_text(transcript)
        data = self._generate_json(build_summary_prompt(cleaned), temperature=0.2)

        if not isinstance(data, dict):
            raise RuntimeError("Could not parse structured summary from model response.")

        summary = normalize_summary(data)
        summary = validate_structured_summary(summary, cleaned)

        if not any(
            [
                summary.overview_paragraphs,
                summary.key_definitions,
                summary.core_concepts,
                summary.important_examples,
                summary.exam_revision_points,
            ]
        ):
            raise RuntimeError("Generated summary is empty.")

        return summary

    def chat(
        self,
        message: str,
        summary: StructuredSummary,
        history: list[ChatMessage],
        context_chunks: list[str] | None = None,
    ) -> str:
        history_payload = [item.model_dump() for item in history]
        prompt = build_chat_prompt(
            summary=summary.model_dump(),
            message=message,
            history=history_payload,
            context_chunks=context_chunks or [],
        )
        return self._generate(prompt=prompt, temperature=0.35)

    def solver_chat(
        self,
        message: str,
        history: list[ChatMessage],
        image_bytes: bytes | None = None,
        image_mime_type: str | None = None,
        image_data_url: str | None = None,
    ) -> str:
        del image_data_url

        history_payload = [item.model_dump() for item in history]
        prompt = build_solver_chat_prompt(message=message, history=history_payload)

        if image_bytes and image_mime_type:
            parts = [
                prompt,
                {"mime_type": image_mime_type, "data": image_bytes},
            ]
            try:
                return self._generate_multimodal(parts=parts, temperature=0.3)
            except RuntimeError:
                fallback_prompt = (
                    prompt
                    + "\n\nThe uploaded image could not be processed. "
                    + "Explain what is possible from text and request a clearer re-upload if needed."
                )
                return self._generate(prompt=fallback_prompt, temperature=0.3)

        return self._generate(prompt=prompt, temperature=0.3)

    def generate_mcqs(self, summary: StructuredSummary, context_chunks: list[str] | None = None) -> list[MCQItem]:
        # Limit context chunks to top 2 to minimize token consumption and latency
        pruned_chunks = (context_chunks or [])[:2]
        prompt = build_mcq_prompt(summary.model_dump(), context_chunks=pruned_chunks)
        data = self._generate_json(prompt, temperature=0.25, max_output_tokens=1200)

        if isinstance(data, dict):
            mcq_items = data.get("mcqs", [])
        elif isinstance(data, list):
            mcq_items = data
        else:
            raise RuntimeError("Could not parse MCQ JSON response from Gemini.")

        if not isinstance(mcq_items, list) or not mcq_items:
            raise RuntimeError("MCQ response from Gemini is empty.")

        normalized = [normalize_mcq_item(item) for item in mcq_items if isinstance(item, dict)]
        if len(normalized) < 3:
            raise RuntimeError(f"Gemini did not produce enough MCQs (got {len(normalized)}, expected at least 3).")

        return normalized[:5]
