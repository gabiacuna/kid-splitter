import os
import bcrypt
import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db import get_db
from ..dependencies import current_teacher
from ..models.teacher import Teacher
from ..schemas.auth import RegisterRequest, LoginRequest, AuthResponse, TeacherOut

router = APIRouter(prefix="/auth", tags=["auth"])

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

_COOKIE_OPTS = dict(httponly=True, samesite="lax", secure=os.environ.get("ENV") == "production")


async def _supabase_signup(email: str, password: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/auth/v1/signup",
            json={"email": email, "password": password},
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail="Auth provider error on register")
        return resp.json()


async def _supabase_login(email: str, password: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            json={"email": email, "password": password},
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        )
        if resp.status_code != 200:
            return {}
        return resp.json()


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie("access_token", access_token, max_age=3600, **_COOKIE_OPTS)
    response.set_cookie("refresh_token", refresh_token, max_age=604800, **_COOKIE_OPTS)


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(Teacher).where(Teacher.email == body.email))
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    teacher = Teacher(email=body.email, password_hash=password_hash, school_name=body.school_name)
    db.add(teacher)

    auth_data = await _supabase_signup(body.email, body.password)

    await db.commit()
    await db.refresh(teacher)

    access_token  = auth_data.get("access_token", "")
    refresh_token = auth_data.get("refresh_token", "")
    if access_token:
        _set_auth_cookies(response, access_token, refresh_token)

    return AuthResponse(teacher=TeacherOut.model_validate(teacher))


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    teacher = await db.scalar(select(Teacher).where(Teacher.email == body.email))
    invalid_creds = HTTPException(status_code=401, detail="Invalid credentials")

    if not teacher:
        raise invalid_creds

    if not bcrypt.checkpw(body.password.encode(), teacher.password_hash.encode()):
        raise invalid_creds

    auth_data = await _supabase_login(body.email, body.password)
    access_token  = auth_data.get("access_token", "")
    refresh_token = auth_data.get("refresh_token", "")
    if not access_token:
        raise HTTPException(status_code=500, detail="Auth provider error on login")

    _set_auth_cookies(response, access_token, refresh_token)
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
    _set_auth_cookies(response, data["access_token"], data["refresh_token"])
    return {"detail": "Refreshed"}


@router.post("/logout")
async def logout(response: Response, teacher: Teacher = Depends(current_teacher)):
    response.set_cookie("access_token", "", max_age=0, **_COOKIE_OPTS)
    response.set_cookie("refresh_token", "", max_age=0, **_COOKIE_OPTS)
    return {"detail": "Logged out"}


@router.get("/me", response_model=TeacherOut)
async def me(teacher: Teacher = Depends(current_teacher)):
    return TeacherOut.model_validate(teacher)
