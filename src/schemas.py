"""Validation des requêtes entrantes."""
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from .config import DEFAULT_LEVEL, DEFAULT_MODEL, LEVELS, LIMITS, MODELS

Text = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=LIMITS.max_message_chars),
]


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: Text


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=LIMITS.max_messages)
    level: str = DEFAULT_LEVEL
    model: str = DEFAULT_MODEL

    @field_validator("level")
    @classmethod
    def check_level(cls, value: str) -> str:
        if value not in LEVELS:
            raise ValueError("niveau inconnu")
        return value

    @field_validator("model")
    @classmethod
    def check_model(cls, value: str) -> str:
        if value not in MODELS:
            raise ValueError("modèle inconnu")
        return value

    @model_validator(mode="after")
    def check_conversation(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("le dernier message doit venir de l'utilisateur")
        if any(m.role == "user" and len(m.content) > LIMITS.max_user_chars for m in self.messages):
            raise ValueError("message utilisateur trop long")
        return self

    def history(self) -> list[dict[str, str]]:
        raw = [m.model_dump() for m in self.messages]
        return trim_history(raw, LIMITS.history_budget_chars)


def trim_history(messages: list[dict[str, str]], budget: int) -> list[dict[str, str]]:
    """Garde les messages les plus récents dans le budget de caractères."""
    kept: list[dict[str, str]] = []
    total = 0
    for message in reversed(messages):
        total += len(message["content"])
        if kept and total > budget:
            break
        kept.append(message)
    kept.reverse()
    while len(kept) > 1 and kept[0]["role"] != "user":
        kept.pop(0)
    return kept
