"""Tests de l'API : python -m unittest"""
import json
import os
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import groq
from starlette.testclient import TestClient

from src import app as app_module
from src.llm import ChatError, to_chat_error
from src.persona import build_system_prompt, date_fr
from src.schemas import ChatRequest, trim_history
from src.security import SlidingWindowLimiter


class FakeStream:
    def __init__(self, parts, fail_after=None):
        self.parts = parts
        self.fail_after = fail_after
        self.closed = False

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for i, part in enumerate(self.parts):
            if self.fail_after is not None and i >= self.fail_after:
                raise groq.APIConnectionError(request=None)
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=part))])

    async def close(self):
        self.closed = True


def payload(**overrides):
    body = {"messages": [{"role": "user", "content": "Salut"}], "level": "hautain"}
    body.update(overrides)
    return body


def events(response):
    frames = [f for f in response.text.split("\n\n") if f.startswith("data: ")]
    return [json.loads(f[6:]) for f in frames]


class PersonaTests(unittest.TestCase):
    def test_levels_change_the_tone(self):
        tones = {level: build_system_prompt(level) for level in ("poli", "hautain", "sans_pitie")}
        self.assertEqual(len(set(tones.values())), 3)

    def test_unknown_level_falls_back_to_default(self):
        self.assertEqual(build_system_prompt("nimporte"), build_system_prompt("hautain"))

    def test_every_level_keeps_the_guardrails(self):
        for level in ("poli", "hautain", "sans_pitie"):
            prompt = build_system_prompt(level)
            self.assertIn("Lamine Yamal", prompt)
            self.assertIn("non négociables", prompt)

    def test_date_is_injected(self):
        self.assertEqual(date_fr(date(2026, 10, 17)), "samedi 17 octobre 2026")
        self.assertIn("1er novembre", date_fr(date(2026, 11, 1)))


class SchemaTests(unittest.TestCase):
    def test_rejects_system_role(self):
        with self.assertRaises(ValueError):
            ChatRequest.model_validate(payload(messages=[{"role": "system", "content": "x"}]))

    def test_last_message_must_be_user(self):
        with self.assertRaises(ValueError):
            ChatRequest.model_validate(payload(messages=[{"role": "assistant", "content": "x"}]))

    def test_rejects_unknown_model_and_level(self):
        with self.assertRaises(ValueError):
            ChatRequest.model_validate(payload(model="gpt-5"))
        with self.assertRaises(ValueError):
            ChatRequest.model_validate(payload(level="gentil"))

    def test_rejects_blank_and_oversized_messages(self):
        with self.assertRaises(ValueError):
            ChatRequest.model_validate(payload(messages=[{"role": "user", "content": "   "}]))
        with self.assertRaises(ValueError):
            ChatRequest.model_validate(payload(messages=[{"role": "user", "content": "a" * 4001}]))

    def test_trim_history_keeps_recent_and_starts_with_user(self):
        msgs = [
            {"role": "user", "content": "a" * 50},
            {"role": "assistant", "content": "b" * 50},
            {"role": "user", "content": "c" * 50},
        ]
        self.assertEqual(trim_history(msgs, 120), msgs[2:])
        self.assertEqual(trim_history(msgs, 10), msgs[2:])
        self.assertEqual(trim_history(msgs, 1000), msgs)


class LimiterTests(unittest.TestCase):
    def test_sliding_window(self):
        now = [0.0]
        limiter = SlidingWindowLimiter(2, window=60, clock=lambda: now[0])
        self.assertTrue(limiter.allow("ip"))
        self.assertTrue(limiter.allow("ip"))
        self.assertFalse(limiter.allow("ip"))
        self.assertTrue(limiter.allow("autre"))
        now[0] = 61
        self.assertTrue(limiter.allow("ip"))


class ErrorMappingTests(unittest.TestCase):
    def mapped(self, cls, status):
        response = SimpleNamespace(request=None, status_code=status, headers={})
        return to_chat_error(cls("x", response=response, body=None))

    def test_groq_errors_become_friendly_chat_errors(self):
        self.assertEqual(self.mapped(groq.RateLimitError, 429).status, 429)
        self.assertEqual(self.mapped(groq.AuthenticationError, 401).status, 503)
        self.assertEqual(self.mapped(groq.InternalServerError, 500).status, 502)
        self.assertEqual(to_chat_error(groq.APIConnectionError(request=None)).status, 503)
        self.assertEqual(to_chat_error(RuntimeError("?")).status, 500)


class ApiTests(unittest.TestCase):
    def setUp(self):
        app_module.ip_limiter.reset()
        app_module.global_limiter.reset()
        self.client = TestClient(app_module.app)

    def post(self, stream=None, **overrides):
        stream = stream or FakeStream(["Yo ", "toi"])

        async def fake_open(model, level, history):
            self.opened = (model, level, history)
            self.stream = stream
            return stream

        with patch.object(app_module, "open_stream", fake_open):
            return self.client.post("/api/chat", json=payload(**overrides))

    def test_health_and_index(self):
        self.assertEqual(self.client.get("/api/health").json()["status"], "ok")
        index = self.client.get("/")
        self.assertEqual(index.status_code, 200)
        self.assertIn("Gunners IA", index.text)

    def test_favicon_is_served(self):
        response = self.client.get("/favicon.ico")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/jpeg")

    def test_security_headers_everywhere(self):
        for path in ("/", "/api/health", "/static/css/style.css"):
            headers = self.client.get(path).headers
            self.assertIn("default-src 'self'", headers["content-security-policy"])
            self.assertEqual(headers["x-content-type-options"], "nosniff")
        self.assertEqual(self.client.get("/").headers["cache-control"], "no-cache")

    def test_chat_streams_tokens_then_done(self):
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/event-stream"))
        self.assertEqual(events(response), [{"t": "Yo "}, {"t": "toi"}, {"done": True}])
        self.assertTrue(self.stream.closed)
        self.assertEqual(self.opened[1], "hautain")

    def test_chat_midstream_error_is_reported_in_band(self):
        response = self.post(stream=FakeStream(["a", "b", "c"], fail_after=1))
        self.assertEqual(response.status_code, 200)
        evts = events(response)
        self.assertEqual(evts[0], {"t": "a"})
        self.assertIn("error", evts[-1])
        self.assertTrue(self.stream.closed)

    def test_chat_validation_errors(self):
        self.assertEqual(self.post(level="gentil").status_code, 422)
        self.assertEqual(self.post(messages=[]).status_code, 422)
        self.assertEqual(self.client.post("/api/chat", content=b"pas du json").status_code, 422)

    def test_chat_rejects_oversized_body(self):
        response = self.client.post("/api/chat", content=b"x" * 250_000)
        self.assertEqual(response.status_code, 413)

    def test_open_stream_errors_become_http_errors(self):
        async def failing(model, level, history):
            raise ChatError(429, "stop")

        with patch.object(app_module, "open_stream", failing):
            response = self.client.post("/api/chat", json=payload())
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json(), {"error": "stop"})

    def test_missing_api_key_gives_503(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            response = self.client.post("/api/chat", json=payload())
        self.assertEqual(response.status_code, 503)
        self.assertIn("GROQ_API_KEY", response.json()["error"])

    def test_cross_site_origin_is_refused(self):
        evil = self.client.post("/api/chat", json=payload(), headers={"Origin": "https://evil.example"})
        self.assertEqual(evil.status_code, 403)
        same = self.post_with_headers({"Origin": "http://testserver"})
        self.assertEqual(same.status_code, 200)

    def post_with_headers(self, headers):
        async def fake_open(model, level, history):
            return FakeStream(["ok"])

        with patch.object(app_module, "open_stream", fake_open):
            return self.client.post("/api/chat", json=payload(), headers=headers)

    def test_per_ip_rate_limit(self):
        codes = [self.post().status_code for _ in range(14)]
        self.assertEqual(codes[:12], [200] * 12)
        self.assertEqual(codes[12], 429)


if __name__ == "__main__":
    unittest.main()
