from __future__ import annotations

import asyncio
import base64
import logging
import re
from threading import Lock
from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.core.session import SessionStore
from app.models.schemas import (
    AuthResponse,
    AuthUser,
    ChatRequest,
    ChatResponse,
    ExtractCaptionsRequest,
    ExtractCaptionsResponse,
    LoginRequest,
    MCQItem,
    MCQRequest,
    MCQResponse,
    RegisterRequest,
    SolverChatRequest,
    SolverChatResponse,
    StructuredSummary,
    SummarizeRequest,
    SummarizeResponse,
    VideoMetaResponse,
)
from app.services.gemini_service import GeminiService
from app.services.local_ai_service import LocalAIService
from app.services.ollama_service import OllamaService
from app.services.pipeline_utils import (
    build_query_from_summary,
    clean_transcript_text,
    select_top_chunks_for_query,
    split_into_chunks,
)
from app.services.pdf_service import PDFService
from app.services.transcript_service import TranscriptService
from app.services.auth_service import AuthService

logger = logging.getLogger(__name__)
router = APIRouter()

transcript_service = TranscriptService()
pdf_service = PDFService()
local_ai_service = LocalAIService()
ollama_service = OllamaService(
    base_url=settings.ollama_base_url,
    model_name=settings.ollama_model,
    enabled=settings.ollama_enabled,
    request_timeout_seconds=settings.ollama_timeout_seconds,
    retry_cooldown_seconds=settings.ollama_retry_cooldown_seconds,
)
session_store = SessionStore(ttl_minutes=settings.session_ttl_minutes)
auth_service = AuthService()
_gemini_request_lock = Lock()


def run_gemini(api_key: str | None, method_name: str, *args: Any, **kwargs: Any) -> Any:
    effective_key = (api_key or settings.gemini_api_key).strip()
    if not effective_key:
        raise HTTPException(
            status_code=400,
            detail="Gemini API key is not configured. Add your key in Settings or configure GEMINI_API_KEY on the server.",
        )

    # google-generativeai configures its client globally, so serialize key setup and use.
    with _gemini_request_lock:
        service = GeminiService(api_key=effective_key, model_name=settings.gemini_model)
        return getattr(service, method_name)(*args, **kwargs)


def _map_service_error(exc: Exception, provider: str = "Gemini") -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc

    message = str(exc)
    lowered = message.lower()

    if "quota" in lowered or "429" in message or "resource_exhausted" in lowered:
        return HTTPException(
            status_code=429,
            detail=f"{provider} API rate limit or quota exceeded. Please check your Google AI Studio quota or wait before retrying.",
        )
    if "404" in message or "not found" in lowered or "no longer available" in lowered:
        return HTTPException(
            status_code=404,
            detail=f"{provider} model is unavailable or has been deprecated. Please verify GEMINI_MODEL in backend/.env (e.g. models/gemini-3.8-flash).",
        )
    if "503" in message or "unavailable" in lowered or "high demand" in lowered:
        return HTTPException(
            status_code=503,
            detail=f"{provider} is currently experiencing high demand. Please try again in a few moments.",
        )
    if "504" in message or "deadline" in lowered or "timed out" in lowered or "timeout" in lowered:
        return HTTPException(
            status_code=504,
            detail=f"{provider} request timed out while generating results. Please retry with a shorter excerpt or try again.",
        )
    if "unauthorized" in lowered or "forbidden" in lowered or "401" in message or "403" in message or "api_key" in lowered:
        return HTTPException(
            status_code=401,
            detail=f"{provider} API key is invalid or unauthorized. Check the key in Settings or verify GEMINI_API_KEY in backend/.env.",
        )
    if "invalid image" in lowered or "unable to process input image" in lowered:
        return HTTPException(
            status_code=400,
            detail="Invalid image payload. Please provide a supported JPEG, PNG, or WEBP image under 8MB.",
        )
    if "connection refused" in lowered or "cannot connect" in lowered or "connecterror" in lowered:
        return HTTPException(
            status_code=503,
            detail="Local Ollama server is unreachable. Please verify Ollama is running (`ollama serve`).",
        )

    return HTTPException(status_code=502, detail=f"{provider} error: {message}")


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header.")

    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid authorization header format.")

    return parts[1].strip()


def _get_current_user(authorization: str | None = Header(default=None)) -> AuthUser:
    token = _extract_bearer_token(authorization)
    return auth_service.verify_access_token(token)


def _ensure_user_session(session_id: str | None, user: AuthUser) -> str:
    try:
        return session_store.ensure(session_id, owner_id=user.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="Session does not belong to this user.") from exc


def _get_user_session(session_id: str, user: AuthUser) -> dict[str, Any] | None:
    try:
        return session_store.get(session_id, owner_id=user.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="Session does not belong to this user.") from exc


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/register", response_model=AuthResponse)
async def auth_register(payload: RegisterRequest) -> AuthResponse:
    user = auth_service.register_user(
        name=payload.name,
        email=payload.email,
        password=payload.password,
        role=payload.role,
        department=payload.department,
    )
    access_token, expires_in = auth_service.create_access_token(user)
    return AuthResponse(access_token=access_token, expires_in=expires_in, user=user)


@router.post("/auth/login", response_model=AuthResponse)
async def auth_login(payload: LoginRequest) -> AuthResponse:
    user = auth_service.authenticate_user(
        email=payload.email,
        password=payload.password,
    )
    access_token, expires_in = auth_service.create_access_token(user)
    return AuthResponse(access_token=access_token, expires_in=expires_in, user=user)


@router.get("/auth/me", response_model=AuthUser)
async def auth_me(authorization: str | None = Header(default=None)) -> AuthUser:
    return _get_current_user(authorization)


@router.post("/extract_captions", response_model=ExtractCaptionsResponse)
async def extract_captions(
    payload: ExtractCaptionsRequest,
    current_user: AuthUser = Depends(_get_current_user),
) -> ExtractCaptionsResponse:
    del current_user
    try:
        result = await transcript_service.extract(payload.youtube_url, payload.language)
        return ExtractCaptionsResponse(
            video_id=result.video_id,
            transcript=result.transcript,
            title=result.title,
            thumbnail_url=result.thumbnail_url,
            channel_title=result.channel_title,
            used_title_fallback=result.used_title_fallback,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Caption extraction failed: %s", exc)
        raise _map_service_error(exc) from exc


@router.post("/video_meta", response_model=VideoMetaResponse)
async def video_meta(
    payload: ExtractCaptionsRequest,
    current_user: AuthUser = Depends(_get_current_user),
) -> VideoMetaResponse:
    del current_user
    try:
        data = await transcript_service.get_video_meta(payload.youtube_url)
        return VideoMetaResponse(
            video_id=data["video_id"],
            title=data.get("title", ""),
            thumbnail_url=data.get("thumbnail_url", ""),
            channel_title=data.get("channel_title", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Video metadata extraction failed: %s", exc)
        raise _map_service_error(exc) from exc


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize(
    payload: SummarizeRequest,
    current_user: AuthUser = Depends(_get_current_user),
    gemini_api_key: str | None = Header(default=None, alias="X-Gemini-Api-Key"),
) -> SummarizeResponse:
    cleaned_transcript = clean_transcript_text(payload.transcript)
    session_id = _ensure_user_session(payload.session_id, current_user)

    try:
        summary = await asyncio.to_thread(
            lambda: run_gemini(gemini_api_key, "summarize", cleaned_transcript)
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Summarization failed with Gemini: %s", exc)
        raise _map_service_error(exc, provider="Gemini") from exc

    session_store.set_transcript(session_id, cleaned_transcript, owner_id=current_user.id)
    session_store.set_summary(session_id, summary.model_dump(), owner_id=current_user.id)
    session_store.set_retrieval_chunks(
        session_id,
        split_into_chunks(cleaned_transcript, max_chars=1400, overlap_chars=120, max_chunks=24),
        owner_id=current_user.id,
    )

    return SummarizeResponse(session_id=session_id, summary=summary)


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    current_user: AuthUser = Depends(_get_current_user),
    gemini_api_key: str | None = Header(default=None, alias="X-Gemini-Api-Key"),
) -> ChatResponse:
    session_id = _ensure_user_session(payload.session_id, current_user)

    summary = payload.summary
    if not summary:
        cached_summary = session_store.get_summary(session_id, owner_id=current_user.id)
        if cached_summary:
            summary = StructuredSummary(**cached_summary)

    if not summary:
        raise HTTPException(
            status_code=400,
            detail="No active summary found. Generate summary first or include summary in request.",
        )

    retrieval_chunks = session_store.get_retrieval_chunks(session_id, owner_id=current_user.id)
    if not retrieval_chunks:
        session = _get_user_session(session_id, current_user) or {}
        retrieval_chunks = split_into_chunks(session.get("transcript", ""), max_chars=1400, overlap_chars=120, max_chunks=24)
        if retrieval_chunks:
            session_store.set_retrieval_chunks(session_id, retrieval_chunks, owner_id=current_user.id)

    # Token optimization: retrieve top 3 chunks instead of 4
    context_chunks = select_top_chunks_for_query(payload.message, retrieval_chunks, top_k=3)

    try:
        answer = await asyncio.to_thread(
            lambda: run_gemini(
                gemini_api_key,
                "chat",
                message=payload.message,
                summary=summary,
                history=payload.history,
                context_chunks=context_chunks,
            )
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Chat generation failed: %s", exc)
        raise _map_service_error(exc, provider="Gemini") from exc

    session_store.set_summary(session_id, summary.model_dump(), owner_id=current_user.id)
    session_store.append_chat(session_id, "user", payload.message, owner_id=current_user.id)
    session_store.append_chat(session_id, "assistant", answer, owner_id=current_user.id)

    return ChatResponse(session_id=session_id, answer=answer)


def _decode_image_data_url(data_url: str) -> tuple[bytes, str]:
    if len(data_url) > 11 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image payload is too large. Maximum allowed size is 8 MB.")

    pattern = r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$"
    match = re.match(pattern, data_url.strip(), flags=re.DOTALL)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid image format. Expected base64 data URL.")

    mime_type = match.group(1).lower().strip()
    payload = match.group(2).strip()
    allowed_mime_types = {"image/jpeg", "image/png", "image/webp"}
    if mime_type not in allowed_mime_types:
        raise HTTPException(status_code=400, detail="Unsupported image type. Use JPEG, PNG, or WEBP.")

    try:
        image_bytes = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not decode image payload.") from exc

    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image is too large. Maximum allowed size is 8 MB.")

    return image_bytes, mime_type


@router.post("/solver_chat", response_model=SolverChatResponse)
async def solver_chat(
    payload: SolverChatRequest,
    current_user: AuthUser = Depends(_get_current_user),
    gemini_api_key: str | None = Header(default=None, alias="X-Gemini-Api-Key"),
) -> SolverChatResponse:
    del current_user
    image_bytes: bytes | None = None
    image_mime_type: str | None = None

    if payload.image_data_url:
        image_bytes, image_mime_type = _decode_image_data_url(payload.image_data_url)

    try:
        answer = await asyncio.to_thread(
            lambda: run_gemini(
                gemini_api_key,
                "solver_chat",
                message=payload.message,
                history=payload.history,
                image_bytes=image_bytes,
                image_mime_type=image_mime_type,
                image_data_url=payload.image_data_url,
            )
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Solver chat failed: %s", exc)
        raise _map_service_error(exc, provider="Gemini") from exc

    return SolverChatResponse(answer=answer)


@router.post("/mcq", response_model=MCQResponse)
async def generate_mcq(
    payload: MCQRequest,
    current_user: AuthUser = Depends(_get_current_user),
    gemini_api_key: str | None = Header(default=None, alias="X-Gemini-Api-Key"),
) -> MCQResponse:
    session_id = _ensure_user_session(payload.session_id, current_user)

    summary = payload.summary
    if not summary:
        cached_summary = session_store.get_summary(session_id, owner_id=current_user.id)
        if cached_summary:
            summary = StructuredSummary(**cached_summary)

    if not summary:
        raise HTTPException(
            status_code=400,
            detail="No active summary found. Generate summary first or include summary in request.",
        )

    retrieval_chunks = session_store.get_retrieval_chunks(session_id, owner_id=current_user.id)
    if not retrieval_chunks:
        session = _get_user_session(session_id, current_user) or {}
        retrieval_chunks = split_into_chunks(session.get("transcript", ""), max_chars=1400, overlap_chars=120, max_chunks=24)
        if retrieval_chunks:
            session_store.set_retrieval_chunks(session_id, retrieval_chunks, owner_id=current_user.id)

    summary_query = build_query_from_summary(summary)
    # Token optimization: retrieve top 3 focused chunks instead of 8 (reduces prompt size by ~65%)
    context_chunks = select_top_chunks_for_query(summary_query, retrieval_chunks, top_k=3)

    try:
        mcqs = await asyncio.to_thread(
            lambda: run_gemini(
                gemini_api_key,
                "generate_mcqs",
                summary,
                context_chunks=context_chunks,
            )
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("MCQ generation failed: %s", exc)
        raise _map_service_error(exc) from exc

    session_store.set_summary(session_id, summary.model_dump(), owner_id=current_user.id)
    session_store.set_mcqs(session_id, [item.model_dump() for item in mcqs], owner_id=current_user.id)

    return MCQResponse(session_id=session_id, mcqs=mcqs)


@router.get("/pdf")
async def download_pdf(
    session_id: str = Query(...),
    current_user: AuthUser = Depends(_get_current_user),
) -> StreamingResponse:
    session = _get_user_session(session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired.")

    raw_summary = session.get("summary")
    if not raw_summary:
        raise HTTPException(status_code=400, detail="No summary available for this session.")

    summary = StructuredSummary(**raw_summary)
    mcqs = [MCQItem(**item) for item in session.get("mcqs", [])]

    pdf_bytes = pdf_service.build(summary=summary, mcqs=mcqs)

    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=edu-simplify-{session_id[:8]}.pdf"},
    )
