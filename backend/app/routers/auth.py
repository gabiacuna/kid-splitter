import os
import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db import get_db
from ..dependencies import current_teacher
from ..limiter import limiter
from ..models.teacher import Teacher
from ..schemas.auth import (
    RegisterRequest, LoginRequest, ResendRequest, AuthResponse, RegisterResponse, TeacherOut,
    ForgotPasswordRequest, ResetPasswordRequest,
)
from ..services.supabase_auth import (
    Session, login_outcome, recover_outcome, resend_outcome, reset_password_outcome, signup_outcome,
)

router = APIRouter(prefix="/auth", tags=["auth"])

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
# Where the password-reset email links to. Must be listed in Supabase → Authentication →
# URL Configuration → Redirect URLs, or Supabase falls back to the Site URL.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

_COOKIE_OPTS = dict(httponly=True, samesite="lax", secure=os.environ.get("ENV") == "production")


async def _supabase_post(path: str, payload: dict, params: dict | None = None) -> tuple[int, dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}{path}",
            json=payload,
            params=params,
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        )
    try:
        body = resp.json()
    except ValueError:
        body = {}
    return resp.status_code, body if isinstance(body, dict) else {}


def _set_auth_cookies(response: Response, session: Session) -> None:
    response.set_cookie("access_token", session.access_token, max_age=3600, **_COOKIE_OPTS)
    response.set_cookie("refresh_token", session.refresh_token, max_age=604800, **_COOKIE_OPTS)


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)):
    if await db.scalar(select(Teacher).where(Teacher.email == body.email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    # Supabase first: the local profile is only created once the auth account really exists.
    status, data = await _supabase_post(
        "/auth/v1/signup",
        {"email": body.email, "password": body.password, "data": {"school_name": body.school_name}},
    )
    session = signup_outcome(status, data)

    teacher = Teacher(email=body.email, school_name=body.school_name)
    db.add(teacher)
    await db.commit()
    await db.refresh(teacher)

    if session:
        _set_auth_cookies(response, session)
    return RegisterResponse(teacher=TeacherOut.model_validate(teacher), needs_confirmation=session is None)


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    status, data = await _supabase_post(
        "/auth/v1/token?grant_type=password", {"email": body.email, "password": body.password},
    )
    session, user = login_outcome(status, data)

    # The profile row may be missing (e.g. local DB recreated) — Supabase already vouched
    # for this person, so recreate it from the school name stored at sign-up.
    teacher = await db.scalar(select(Teacher).where(Teacher.email == body.email))
    if not teacher:
        school = (user.get("user_metadata") or {}).get("school_name") or ""
        teacher = Teacher(email=body.email, school_name=school)
        db.add(teacher)
        await db.commit()
        await db.refresh(teacher)

    _set_auth_cookies(response, session)
    return AuthResponse(teacher=TeacherOut.model_validate(teacher))


@router.post("/resend-confirmation")
@limiter.limit("5/hour")
async def resend_confirmation(request: Request, body: ResendRequest):
    """Re-send the sign-up confirmation email. Same answer for unknown or already-confirmed
    emails (no account probing); Supabase also rate-limits per address."""
    status, data = await _supabase_post("/auth/v1/resend", {"type": "signup", "email": body.email})
    resend_outcome(status, data)
    return {"detail": "If this email has an unconfirmed account, a new confirmation link is on its way."}


@router.post("/forgot-password")
@limiter.limit("5/hour")
async def forgot_password(request: Request, body: ForgotPasswordRequest):
    """Send a password-reset email. The answer is the same whether or not the email has an
    account (no probing); Supabase also rate-limits per address."""
    status, data = await _supabase_post(
        "/auth/v1/recover", {"email": body.email},
        params={"redirect_to": f"{FRONTEND_URL.rstrip('/')}/reset-password"},
    )
    recover_outcome(status, data)
    return {"detail": "If this email has an account, a reset link is on its way."}


@router.post("/reset-password", status_code=204)
@limiter.limit("10/hour")
async def reset_password(request: Request, body: ResetPasswordRequest):
    """Set a new password with the access token from the recovery link (in the URL fragment
    of /reset-password). No session is created: the teacher signs in with the new password."""
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{SUPABASE_URL}/auth/v1/user",
            json={"password": body.new_password},
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {body.access_token}"},
        )
    try:
        data = resp.json()
    except ValueError:
        data = {}
    reset_password_outcome(resp.status_code, data if isinstance(data, dict) else {})


@router.post("/refresh")
async def refresh(response: Response, refresh_token: str | None = Cookie(default=None)):
    if not refresh_token:
        raise HTTPException(status_code=401)
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token",
            json={"refresh_token": refresh_token},
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401)
    data = resp.json()
    _set_auth_cookies(response, Session(data["access_token"], data["refresh_token"]))
    return {"detail": "Refreshed"}


@router.post("/logout")
async def logout(response: Response, teacher: Teacher = Depends(current_teacher)):
    response.set_cookie("access_token", "", max_age=0, **_COOKIE_OPTS)
    response.set_cookie("refresh_token", "", max_age=0, **_COOKIE_OPTS)
    return {"detail": "Logged out"}


@router.get("/me", response_model=TeacherOut)
async def me(teacher: Teacher = Depends(current_teacher)):
    return TeacherOut.model_validate(teacher)
