from fastapi import Depends, HTTPException, Cookie, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import jwt, JWTError
import httpx
import os

from .db import get_db
from .models.teacher import Teacher
from .models.cohort import Cohort

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

_jwks_cache: dict | None = None


async def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
                headers={"apikey": SUPABASE_ANON_KEY},
            )
            resp.raise_for_status()
            _jwks_cache = resp.json()
    return _jwks_cache


async def current_teacher(
    request: Request,
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> Teacher:
    if not access_token:
        raise HTTPException(status_code=401)
    try:
        jwks = await _get_jwks()
        payload = jwt.decode(access_token, jwks, algorithms=["ES256"], audience="authenticated")
        email: str = payload.get("email")
    except (JWTError, httpx.HTTPError):
        raise HTTPException(status_code=401)
    teacher = await db.scalar(select(Teacher).where(Teacher.email == email))
    if not teacher:
        raise HTTPException(status_code=401)
    request.state.teacher_id = teacher.id
    return teacher


async def get_cohort_or_403(
    cohort_id: str,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
) -> Cohort:
    cohort = await db.scalar(
        select(Cohort).where(
            Cohort.id == cohort_id,
            Cohort.teacher_id == teacher.id,
        )
    )
    if not cohort:
        raise HTTPException(status_code=403)
    return cohort
