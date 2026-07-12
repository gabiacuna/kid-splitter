from fastapi import Depends, HTTPException, Cookie, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import jwt, JWTError
import os

from .db import get_db
from .models.teacher import Teacher
from .models.cohort import Cohort

SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")


async def current_teacher(
    request: Request,
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> Teacher:
    if not access_token:
        raise HTTPException(status_code=401)
    try:
        payload = jwt.decode(access_token, SUPABASE_JWT_SECRET, algorithms=["HS256"])
        teacher_id: str = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401)
    teacher = await db.get(Teacher, teacher_id)
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
