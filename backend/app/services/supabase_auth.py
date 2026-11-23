"""Interpreting Supabase Auth responses.

Supabase is the only source of truth for passwords; the local `teachers` row is just a
profile keyed by email. These helpers turn Supabase's responses into app outcomes without
any I/O, so the tricky cases are unit-testable (tests/test_supabase_auth.py).
"""
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException


@dataclass
class Session:
    access_token:  str
    refresh_token: str


def _error_code(body: dict) -> str:
    # Newer GoTrue: {"code": 422, "error_code": "weak_password", "msg": ...};
    # older: {"error": "invalid_grant", "error_description": "Email not confirmed"}.
    code = body.get("error_code") or body.get("code") or body.get("error") or ""
    desc = (body.get("msg") or body.get("error_description") or body.get("message") or "").lower()
    if code == "invalid_grant" and "not confirmed" in desc:
        return "email_not_confirmed"
    if code == "invalid_grant":
        return "invalid_credentials"
    return str(code)


def signup_outcome(status: int, body: dict) -> Optional[Session]:
    """Session if the account is usable now, None if Supabase sent a confirmation email.
    Raises HTTPException for everything else."""
    if status in (200, 201):
        user = body.get("user") or body
        # With email confirmation on, signing up an email that already exists returns a
        # fake user with no identities (to avoid leaking which emails are registered) and
        # sends nothing. Treat it as "already registered" instead of a silent dead end.
        if user.get("identities") == []:
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        if body.get("access_token"):
            return Session(body["access_token"], body.get("refresh_token", ""))
        return None
    code = _error_code(body)
    if code in ("user_already_exists", "email_exists"):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    if code == "weak_password":
        raise HTTPException(status_code=422, detail=body.get("msg") or "Password is too weak")
    if status == 429 or "rate_limit" in code:
        raise HTTPException(status_code=429, detail="Too many sign-up attempts — try again later")
    raise HTTPException(status_code=502, detail="Sign-up failed at the auth provider")


def login_outcome(status: int, body: dict) -> tuple[Session, dict]:
    """(session, supabase user) on success; HTTPException otherwise."""
    if status == 200 and body.get("access_token"):
        return Session(body["access_token"], body.get("refresh_token", "")), body.get("user") or {}
    code = _error_code(body)
    if code == "email_not_confirmed":
        raise HTTPException(status_code=403, detail="Email not confirmed")
    if code == "invalid_credentials" or status in (400, 401):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if status == 429:
        raise HTTPException(status_code=429, detail="Too many attempts — try again later")
    raise HTTPException(status_code=502, detail="Login failed at the auth provider")


def resend_outcome(status: int, body: dict) -> None:
    """Resend the sign-up confirmation email. Answers the same way whether or not the
    email exists or is already confirmed, so the endpoint can't be used to probe accounts;
    only rate limits (which the teacher can act on) and provider outages are surfaced."""
    if status == 429 or "rate_limit" in _error_code(body):
        raise HTTPException(status_code=429, detail="Please wait a minute before requesting another email")
    if status >= 500:
        raise HTTPException(status_code=502, detail="Could not send the email right now")
