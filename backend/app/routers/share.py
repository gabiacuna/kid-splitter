import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db import get_db
from ..dependencies import get_solution_or_403
from ..limiter import limiter
from ..models.cohort import Cohort
from ..models.student import Student
from ..models.solution import Solution, ClassAssignment
from ..schemas.share import ShareTokenOut, PublicSolutionOut, PublicClassOut, PublicStudentOut

router = APIRouter(tags=["share"])

SHARE_BASE_URL = os.environ.get("SHARE_BASE_URL", "http://localhost:5173")
WHITELISTED_TAGS = {"esl", "gifted", "new-student"}


@router.post("/solutions/{solution_id}/share", response_model=ShareTokenOut, status_code=201)
async def create_share_token(
    owned: tuple[Solution, Cohort] = Depends(get_solution_or_403),
    db: AsyncSession = Depends(get_db),
):
    sol, _ = owned

    if sol.share_token and sol.share_enabled:
        return ShareTokenOut(
            solution_id=sol.id,
            share_token=sol.share_token,
            share_url=f"{SHARE_BASE_URL}/share/{sol.share_token}",
            share_enabled=True,
        )

    token = str(uuid.uuid4())
    sol.share_token = token
    sol.share_enabled = True
    await db.commit()

    return ShareTokenOut(
        solution_id=sol.id,
        share_token=token,
        share_url=f"{SHARE_BASE_URL}/share/{token}",
        share_enabled=True,
    )


@router.delete("/solutions/{solution_id}/share", status_code=204)
async def revoke_share_token(
    owned: tuple[Solution, Cohort] = Depends(get_solution_or_403),
    db: AsyncSession = Depends(get_db),
):
    sol, _ = owned

    sol.share_token = None
    sol.share_enabled = False
    await db.commit()


@router.get("/share/{token}", response_model=PublicSolutionOut)
@limiter.limit("60/minute")
async def get_shared_solution(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    sol = await db.scalar(
        select(Solution).where(
            Solution.share_token == token,
            Solution.share_enabled == True,
        )
    )
    if not sol:
        raise HTTPException(status_code=404)

    cohort = await db.get(Cohort, sol.cohort_id)

    assignments = (await db.execute(
        select(ClassAssignment, Student)
        .join(Student, Student.id == ClassAssignment.student_id)
        .where(ClassAssignment.solution_id == sol.id)
    )).all()

    by_class: dict[int, list[PublicStudentOut]] = {}
    for assignment, student in assignments:
        safe_tags = [t for t in (student.tags or []) if t in WHITELISTED_TAGS]
        by_class.setdefault(assignment.class_number, []).append(
            PublicStudentOut(first_name=student.first_name, tags=safe_tags)
        )

    # A list (not a dict keyed by class) — the share page iterates it.
    return PublicSolutionOut(
        solution_id=sol.id,
        cohort_name=cohort.name if cohort else "",
        label=sol.label or "",
        classes=[PublicClassOut(class_number=k, students=v) for k, v in sorted(by_class.items())],
    )
