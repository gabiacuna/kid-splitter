"""The teacher's own account: profile, data export, and deletion."""
import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..dependencies import current_teacher
from ..limiter import limiter
from ..models.cohort import Cohort
from ..models.solution import ClassAssignment, Solution
from ..models.student import Student
from ..models.teacher import Teacher
from ..schemas.account import AccountSummary, ChangePasswordRequest, DeleteAccountRequest, UpdateAccountRequest
from ..schemas.auth import TeacherOut
from ..services.export import (
    XLSX_MEDIA_TYPE, CohortExport, build_account_workbook, content_disposition, safe_filename_stem,
)
from ..services.supabase_auth import (
    admin_delete_outcome, login_outcome, metadata_update_outcome, password_update_outcome,
)
from .auth import _COOKIE_OPTS, SUPABASE_ANON_KEY, SUPABASE_URL, _set_auth_cookies, _supabase_post

router = APIRouter(prefix="/account", tags=["account"])

# Server-only admin key (Supabase dashboard → Project Settings → API Keys → Secret keys).
# Needed only to delete the login itself; everything else works without it.
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")

# Solutions created within this window of a cohort's newest one belong to the latest run.
LATEST_RUN_WINDOW_S = 60


@router.get("/summary", response_model=AccountSummary)
async def summary(teacher: Teacher = Depends(current_teacher), db: AsyncSession = Depends(get_db)):
    """What deleting the account would remove — shown in the confirmation dialog."""
    mine = select(Cohort.id).where(Cohort.teacher_id == teacher.id)
    count = lambda col, where: select(func.count(col)).where(where).scalar_subquery()  # noqa: E731
    row = (await db.execute(select(
        count(Cohort.id, Cohort.teacher_id == teacher.id),
        count(Student.id, Student.cohort_id.in_(mine)),
        count(Solution.id, Solution.cohort_id.in_(mine)),
        count(Solution.id, Solution.cohort_id.in_(mine) & Solution.share_enabled.is_(True)),
    ))).one()
    return AccountSummary(cohorts=row[0], students=row[1], solutions=row[2], share_links=row[3])


@router.put("", response_model=TeacherOut)
async def update_account(
    body: UpdateAccountRequest,
    teacher: Teacher = Depends(current_teacher),
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
):
    # Supabase metadata first: login recreates a missing local profile from it, so it
    # must never hold an older school name than the local row.
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{SUPABASE_URL}/auth/v1/user",
            json={"data": {"school_name": body.school_name}},
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {access_token}"},
        )
    metadata_update_outcome(resp.status_code, {})
    teacher.school_name = body.school_name
    await db.commit()
    await db.refresh(teacher)
    return TeacherOut.model_validate(teacher)


@router.post("/password", status_code=204)
@limiter.limit("10/hour")
async def change_password(
    request: Request,
    body: ChangePasswordRequest,
    response: Response,
    teacher: Teacher = Depends(current_teacher),
):
    """Change the teacher's password after re-verifying the current one."""
    if body.new_password == body.current_password:
        raise HTTPException(status_code=422, detail="New password must be different from your current password")

    status, data = await _supabase_post(
        "/auth/v1/token?grant_type=password", {"email": teacher.email, "password": body.current_password},
    )
    try:
        session, _ = login_outcome(status, data)
    except HTTPException as e:
        # 403, not 401: the api client treats 401 as "session expired" and would refresh
        # the token and send this password a second time.
        if e.status_code == 401:
            raise HTTPException(status_code=403, detail="Incorrect password")
        raise

    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{SUPABASE_URL}/auth/v1/user",
            json={"password": body.new_password},
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {session.access_token}"},
        )
    try:
        resp_body = resp.json()
    except ValueError:
        resp_body = {}
    password_update_outcome(resp.status_code, resp_body if isinstance(resp_body, dict) else {})
    _set_auth_cookies(response, session)



@router.get("/export.xlsx")
async def export_account(teacher: Teacher = Depends(current_teacher), db: AsyncSession = Depends(get_db)):
    cohorts = (await db.execute(
        select(Cohort).where(Cohort.teacher_id == teacher.id).order_by(Cohort.created_at)
    )).scalars().all()
    ids = [c.id for c in cohorts]
    students = (await db.execute(
        select(Student).where(Student.cohort_id.in_(ids)).order_by(Student.last_name, Student.first_name)
    )).scalars().all() if ids else []
    solutions = (await db.execute(
        select(Solution).where(Solution.cohort_id.in_(ids)).order_by(Solution.created_at.desc())
    )).scalars().all() if ids else []

    latest: dict[str, list[Solution]] = {}
    for sol in solutions:  # newest first
        run = latest.setdefault(sol.cohort_id, [])
        if not run or (run[0].created_at - sol.created_at).total_seconds() <= LATEST_RUN_WINDOW_S:
            run.append(sol)
    sol_ids = [s.id for run in latest.values() for s in run]
    assignments: dict[str, dict[str, int]] = {sid: {} for sid in sol_ids}
    if sol_ids:
        for solution_id, student_id, k in (await db.execute(
            select(ClassAssignment.solution_id, ClassAssignment.student_id, ClassAssignment.class_number)
            .where(ClassAssignment.solution_id.in_(sol_ids))
        )).all():
            assignments[solution_id][student_id] = k

    by_cohort: dict[str, list[Student]] = {}
    for s in students:
        by_cohort.setdefault(s.cohort_id, []).append(s)
    data = [
        CohortExport(
            name=c.name,
            year=c.year,
            students=[(s.id, s.first_name, s.last_name, s.gender or "", ", ".join(s.tags or [])) for s in by_cohort.get(c.id, [])],
            solutions=[(sol.label or "", assignments[sol.id]) for sol in sorted(latest.get(c.id, []), key=lambda x: x.label or "")],
        )
        for c in cohorts
    ]
    now = datetime.now(timezone.utc)
    content = build_account_workbook(teacher.school_name, now.strftime("%Y-%m-%d %H:%M UTC"), data)
    stem = safe_filename_stem(f"kid splitter - {teacher.school_name} - {now:%Y-%m-%d}")
    return Response(content=content, media_type=XLSX_MEDIA_TYPE,
                    headers={"Content-Disposition": content_disposition(f"{stem}.xlsx")})


@router.post("/delete", status_code=204)
@limiter.limit("5/hour")
async def delete_account(
    request: Request,
    body: DeleteAccountRequest,
    response: Response,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete the login and every cohort, student, rule, solution and share link.
    The password is re-checked so an unattended session can't do this."""
    if not SUPABASE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Account deletion isn't configured on this server yet")

    status, data = await _supabase_post(
        "/auth/v1/token?grant_type=password", {"email": teacher.email, "password": body.password},
    )
    try:
        _, user = login_outcome(status, data)
    except HTTPException as e:
        # 403, not 401: the api client treats 401 as "session expired" and would refresh
        # the token and send this password a second time.
        if e.status_code == 401:
            raise HTTPException(status_code=403, detail="Incorrect password")
        raise

    # Login first: if this fails nothing is deleted. If the local delete then fails, the
    # login is already gone, so the account can't be used either way.
    async with httpx.AsyncClient() as client:
        resp = await client.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user['id']}",
            headers={"apikey": SUPABASE_SECRET_KEY, "Authorization": f"Bearer {SUPABASE_SECRET_KEY}"},
        )
    admin_delete_outcome(resp.status_code, {})

    await db.delete(teacher)  # ON DELETE CASCADE removes cohorts and everything under them
    await db.commit()
    response.set_cookie("access_token", "", max_age=0, **_COOKIE_OPTS)
    response.set_cookie("refresh_token", "", max_age=0, **_COOKIE_OPTS)
