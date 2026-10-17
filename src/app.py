"""Application web Starlette : API de chat en streaming + interface statique."""
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit

from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .config import LIMITS, STATIC_DIR, api_key
from .llm import ChatError, close_stream, iter_text, open_stream, to_chat_error
from .schemas import ChatRequest
from .security import SecurityHeaders, SlidingWindowLimiter

log = logging.getLogger("gunners.app")

ip_limiter = SlidingWindowLimiter(LIMITS.ip_per_minute)
global_limiter = SlidingWindowLimiter(LIMITS.global_per_minute)


def error(message: str, status: int, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status, headers=headers)


def sse(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def event_stream(stream: Any) -> AsyncIterator[str]:
    try:
        async for text in iter_text(stream):
            yield sse({"t": text})
        yield sse({"done": True})
    except Exception as exc:
        log.warning("Flux Groq interrompu : %r", exc)
        yield sse({"error": to_chat_error(exc).message})
    finally:
        await close_stream(stream)


def foreign_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    return bool(origin) and urlsplit(origin).netloc != request.headers.get("host")


async def chat(request: Request) -> Response:
    if foreign_origin(request):
        return error("Origine refusée.", 403)
    ip = request.client.host if request.client else "inconnu"
    if not (ip_limiter.allow(ip) and global_limiter.allow("*")):
        return error("Doucement, les Gunners rechargent. Réessaie dans une minute.", 429, {"Retry-After": "60"})

    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > LIMITS.max_body_bytes:
        return error("Requête trop volumineuse.", 413)
    body = await request.body()
    if len(body) > LIMITS.max_body_bytes:
        return error("Requête trop volumineuse.", 413)

    try:
        payload = ChatRequest.model_validate_json(body)
    except ValidationError:
        return error("Requête invalide.", 422)

    try:
        stream = await open_stream(payload.model, payload.level, payload.history())
    except ChatError as exc:
        return error(exc.message, exc.status)

    return StreamingResponse(
        event_stream(stream),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


async def health(request: Request) -> Response:
    return JSONResponse({"status": "ok", "groq_configured": api_key() is not None})


async def index(request: Request) -> Response:
    return FileResponse(STATIC_DIR / "index.html")


async def favicon(request: Request) -> Response:
    return FileResponse(STATIC_DIR / "img" / "logo-canon.jpg", media_type="image/jpeg")


@asynccontextmanager
async def lifespan(app: Starlette):
    if api_key() is None:
        log.warning("GROQ_API_KEY absente : l'interface s'ouvrira mais le chat sera indisponible.")
    yield


app = Starlette(
    routes=[
        Route("/", index),
        Route("/favicon.ico", favicon),
        Route("/api/health", health),
        Route("/api/chat", chat, methods=["POST"]),
        Mount("/static", StaticFiles(directory=STATIC_DIR), name="static"),
    ],
    middleware=[Middleware(SecurityHeaders)],
    lifespan=lifespan,
)
