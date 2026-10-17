"""Accès à l'API Groq : ouverture du flux, lecture des tokens, gestion des erreurs."""
import logging
from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

import anyio
import groq
from groq import AsyncGroq

from .config import LIMITS, MODELS, api_key
from .persona import build_system_prompt

log = logging.getLogger("gunners.llm")


class ChatError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@lru_cache(maxsize=1)
def _build_client(key: str) -> AsyncGroq:
    return AsyncGroq(api_key=key, timeout=60.0, max_retries=1)


def get_client() -> AsyncGroq:
    key = api_key()
    if not key:
        raise ChatError(503, "Clé API manquante côté serveur : renseigne GROQ_API_KEY.")
    return _build_client(key)


def to_chat_error(exc: Exception) -> ChatError:
    if isinstance(exc, ChatError):
        return exc
    if isinstance(exc, groq.RateLimitError):
        return ChatError(429, "Les Gunners ont trop tiré : limite Groq atteinte. Réessaie dans quelques secondes.")
    if isinstance(exc, (groq.AuthenticationError, groq.PermissionDeniedError)):
        log.error("Clé Groq refusée : %s", exc.message)
        return ChatError(503, "Groq refuse la clé API du serveur. Vérifie GROQ_API_KEY.")
    if isinstance(exc, groq.APIConnectionError):
        return ChatError(503, "Impossible de joindre Groq pour l'instant. Réessaie.")
    if isinstance(exc, groq.APIStatusError):
        log.error("Erreur Groq %s : %s", exc.status_code, exc.message)
        return ChatError(502, f"Groq a répondu par une erreur ({exc.status_code}). Réessaie.")
    log.error("Erreur inattendue", exc_info=exc)
    return ChatError(500, "Erreur inattendue côté serveur.")


async def open_stream(model: str, level: str, history: list[dict[str, str]]) -> Any:
    """Ouvre le flux Groq ; les erreurs de connexion sortent ici, avant le premier token."""
    client = get_client()
    messages = [{"role": "system", "content": build_system_prompt(level)}, *history]
    options = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": 0.8,
        "max_completion_tokens": LIMITS.max_output_tokens,
    }
    tuning = {"reasoning_effort": MODELS[model]["effort"], "include_reasoning": False}
    try:
        try:
            return await client.chat.completions.create(**options, extra_body=tuning)
        except groq.BadRequestError as exc:
            log.warning("Réglages de raisonnement refusés (%s), nouvel essai sans.", exc.message)
            return await client.chat.completions.create(**options)
    except Exception as exc:
        raise to_chat_error(exc) from exc


async def iter_text(stream: Any) -> AsyncIterator[str]:
    async for chunk in stream:
        if not chunk.choices:
            continue
        text = chunk.choices[0].delta.content
        if text:
            yield text


async def close_stream(stream: Any) -> None:
    """Ferme la connexion Groq, même si la requête du navigateur a été annulée."""
    with anyio.CancelScope(shield=True):
        try:
            await stream.close()
        except Exception:
            log.debug("Fermeture du flux Groq ignorée", exc_info=True)
