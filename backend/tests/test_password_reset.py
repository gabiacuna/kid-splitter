"""Forgot / reset password, with Supabase mocked (no network, no database).
Run: uv run pytest tests/test_password_reset.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.limiter import limiter
from app.main import app
from app.routers import auth
from app.services.supabase_auth import recover_outcome, reset_password_outcome


def raises(fn, status, detail=None):
    with pytest.raises(HTTPException) as e:
        fn()
    assert e.value.status_code == status
    if detail is not None:
        assert e.value.detail == detail


def test_recover_outcome_is_neutral():
    recover_outcome(200, {})
    recover_outcome(400, {"error_code": "user_not_found"})        # unknown email: same answer
    recover_outcome(422, {"error_code": "email_address_invalid"})
    raises(lambda: recover_outcome(429, {}), 429)
    raises(lambda: recover_outcome(400, {"error_code": "over_email_send_rate_limit"}), 429)
    raises(lambda: recover_outcome(503, {}), 502)


def test_reset_outcome():
    reset_password_outcome(200, {})
    raises(lambda: reset_password_outcome(401, {"error_code": "bad_jwt"}), 400, "link_expired")
    raises(lambda: reset_password_outcome(403, {"error_code": "session_not_found"}), 400, "link_expired")
    raises(lambda: reset_password_outcome(422, {"error_code": "same_password"}), 422)
    raises(lambda: reset_password_outcome(422, {"error_code": "weak_password", "msg": "weak"}), 422, "weak")
    raises(lambda: reset_password_outcome(500, {}), 502)


@pytest.fixture
def client():
    limiter.reset()
    with TestClient(app) as c:
        yield c
    limiter.reset()


def test_forgot_password_sends_redirect_and_answers_neutrally(client, monkeypatch):
    calls = []

    async def fake_post(path, payload, params=None):
        calls.append((path, payload, params))
        return (400, {"error_code": "user_not_found"}) if payload["email"].startswith("nobody") else (200, {})

    monkeypatch.setattr(auth, "_supabase_post", fake_post)
    monkeypatch.setattr(auth, "FRONTEND_URL", "https://app.example/")
    a = client.post("/api/auth/forgot-password", json={"email": "teacher@example.com"})
    b = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert calls[0] == ("/auth/v1/recover", {"email": "teacher@example.com"}, {"redirect_to": "https://app.example/reset-password"})
    assert client.post("/api/auth/forgot-password", json={"email": "not-an-email"}).status_code == 422


def test_forgot_password_is_rate_limited(client, monkeypatch):
    async def fake_post(path, payload, params=None):
        return 200, {}

    monkeypatch.setattr(auth, "_supabase_post", fake_post)
    codes = [client.post("/api/auth/forgot-password", json={"email": "t@example.com"}).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient inside the reset endpoint."""
    response = httpx.Response(200, json={})
    seen: list = []

    def __init__(self, *a, **kw): ...
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False

    async def put(self, url, json=None, headers=None):
        _FakeAsyncClient.seen.append((url, json, headers))
        return _FakeAsyncClient.response


def test_reset_password_uses_the_recovery_token(client, monkeypatch):
    monkeypatch.setattr(auth.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.seen = []
    _FakeAsyncClient.response = httpx.Response(200, json={})
    r = client.post("/api/auth/reset-password", json={"access_token": "tok", "new_password": "a-long-password"})
    assert r.status_code == 204
    url, body, headers = _FakeAsyncClient.seen[0]
    assert url.endswith("/auth/v1/user") and body == {"password": "a-long-password"}
    assert headers["Authorization"] == "Bearer tok"

    _FakeAsyncClient.response = httpx.Response(401, json={"error_code": "bad_jwt"})
    r = client.post("/api/auth/reset-password", json={"access_token": "old", "new_password": "a-long-password"})
    assert r.status_code == 400 and r.json()["detail"] == "link_expired"

    # Short passwords never reach Supabase.
    n = len(_FakeAsyncClient.seen)
    assert client.post("/api/auth/reset-password", json={"access_token": "tok", "new_password": "short"}).status_code == 422
    assert len(_FakeAsyncClient.seen) == n
