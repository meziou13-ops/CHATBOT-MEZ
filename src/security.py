"""Protection de la clé Groq partagée : limitation de débit et en-têtes HTTP."""
import time
from collections import deque
from collections.abc import Callable

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])

HEADERS = {
    b"content-security-policy": CSP.encode(),
    b"x-content-type-options": b"nosniff",
    b"referrer-policy": b"same-origin",
    b"x-frame-options": b"DENY",
}


class SlidingWindowLimiter:
    """Autorise au plus `limit` appels par clé sur une fenêtre glissante."""

    def __init__(self, limit: int, window: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window = window
        self.clock = clock
        self.hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = self.clock()
        queue = self.hits.setdefault(key, deque())
        while queue and now - queue[0] > self.window:
            queue.popleft()
        if len(queue) >= self.limit:
            return False
        queue.append(now)
        if len(self.hits) > 1000:
            self._drop_idle(now)
        return True

    def reset(self) -> None:
        self.hits.clear()

    def _drop_idle(self, now: float) -> None:
        idle = [k for k, q in self.hits.items() if not q or now - q[-1] > self.window]
        for key in idle:
            del self.hits[key]


class SecurityHeaders:
    """Middleware ASGI : ajoute les en-têtes de sécurité et évite les caches périmés."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                headers += [(k, v) for k, v in HEADERS.items() if k not in present]
                if b"cache-control" not in present and not scope["path"].startswith("/api/"):
                    headers.append((b"cache-control", b"no-cache"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)
