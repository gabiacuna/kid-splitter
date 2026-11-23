import os
import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db import get_db
from ..dependencies import current_teacher
from ..models.teacher import Teacher
from ..schemas.auth import RegisterRequest, LoginRequest, AuthResponse, RegisterResponse, TeacherOut
from ..services.supabase_auth import Session, login_outcome, signup_outcome

router = APIRouter(prefix="/auth", tags=["auth"])

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

_COOKIE_OPTS = dict(httponly=True, samesite="lax", secure=os.environ.get("ENV") == "production")


async def _supabase_post(path: str, payload: dict) -> tuple[int, dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}{path}",
            json=payload,
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
