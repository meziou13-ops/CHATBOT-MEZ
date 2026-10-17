"""Configuration centrale : chemins, modèles, niveaux et limites."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

load_dotenv(BASE_DIR / ".env")

MODELS = {
    "openai/gpt-oss-20b": {"effort": "low"},
    "openai/gpt-oss-120b": {"effort": "medium"},
}
DEFAULT_MODEL = "openai/gpt-oss-20b"

LEVELS = ("poli", "hautain", "sans_pitie")
DEFAULT_LEVEL = "hautain"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Limits:
    max_body_bytes: int = 200_000
    max_messages: int = 40
    max_message_chars: int = 12_000
    max_user_chars: int = 4_000
    history_budget_chars: int = 12_000
    max_output_tokens: int = 1_500
    ip_per_minute: int = _int_env("RATE_LIMIT_IP_PER_MINUTE", 12)
    global_per_minute: int = _int_env("RATE_LIMIT_GLOBAL_PER_MINUTE", 25)


LIMITS = Limits()


def api_key() -> str | None:
    return os.environ.get("GROQ_API_KEY") or None
