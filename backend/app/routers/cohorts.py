from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..db import get_db
from ..dependencies import current_teacher, get_cohort_or_403
from ..models.cohort import Cohort
from ..models.student import Student
from ..models.solution import Solution
from ..models.teacher import Teacher
from ..schemas.cohort import CohortCreate, CohortUpdate, CohortOut, CohortListOut

router = APIRouter(prefix="/cohorts", tags=["cohorts"])


async def _student_count(db: AsyncSession, cohort_id: str) -> int:
    return await db.scalar(
        select(func.count(Student.id)).where(Student.cohort_id == cohort_id)
    ) or 0


async def _last_solve_at(db: AsyncSession, cohort_id: str):
    return await db.scalar(
        select(func.max(Solution.created_at)).where(Solution.cohort_id == cohort_id)
    )


async def _cohort_out(db: AsyncSession, cohort: Cohort) -> CohortOut:
    return _build_out(cohort, await _student_count(db, cohort.id), await _last_solve_at(db, cohort.id))


def _build_out(cohort: Cohort, count: int, last_solve_at=None) -> CohortOut:
    return CohortOut(
        id=cohort.id,
        name=cohort.name,
        year=cohort.year,
        num_classes=cohort.num_classes,
        balance_gender=cohort.balance_gender,
        student_count=count,
        last_solve_at=last_solve_at,
        created_at=cohort.created_at,
        updated_at=cohort.updated_at,
    )


@router.get("", response_model=CohortListOut)
async def list_cohorts(
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    # Correlated scalar subqueries: joining students and solutions together would
    # multiply rows (students × solutions per cohort) just to collapse them again.
    student_count = (
        select(func.count(Student.id)).where(Student.cohort_id == Cohort.id).correlate(Cohort).scalar_subquery()
    )
    last_solve_at = (
        select(func.max(Solution.created_at)).where(Solution.cohort_id == Cohort.id).correlate(Cohort).scalar_subquery()
    )
    stmt = (
        select(Cohort, student_count, last_solve_at)
        .where(Cohort.teacher_id == teacher.id)
        .order_by(Cohort.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()
    cohorts = [_build_out(c, cnt, last) for c, cnt, last in rows]
    return CohortListOut(cohorts=cohorts)


@router.post("", response_model=CohortOut, status_code=201)
async def create_cohort(
    body: CohortCreate,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    cohort = Cohort(
        teacher_id=teacher.id,
        name=body.name,
        year=body.year,
        num_classes=body.num_classes,
        balance_gender=body.balance_gender,
    )
    db.add(cohort)
    await db.commit()
    await db.refresh(cohort)
    return _build_out(cohort, 0)


@router.get("/{cohort_id}", response_model=CohortOut)
async def get_cohort(
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    return await _cohort_out(db, cohort)


@router.put("/{cohort_id}")
async def update_cohort(
    body: CohortUpdate,
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    num_classes_changed = body.num_classes is not None and body.num_classes != cohort.num_classes
    warning = None

    if num_classes_changed:
        has_solutions = await db.scalar(
            select(func.count(Solution.id)).where(Solution.cohort_id == cohort.id)
        ) or 0
        if has_solutions:
            warning = "Changing class count requires a new solve. Existing solutions remain valid."

    if body.name is not None:
        cohort.name = body.name
    if body.year is not None:
        cohort.year = body.year
    if body.num_classes is not None:
        cohort.num_classes = body.num_classes
    if body.balance_gender is not None:
        cohort.balance_gender = body.balance_gender

    await db.commit()
    await db.refresh(cohort)
    out = await _cohort_out(db, cohort)

    if warning:
        return {"cohort": out.model_dump(), "warning": warning}
    return out


@router.delete("/{cohort_id}", status_code=204)
async def delete_cohort(
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    await db.delete(cohort)
    await db.commit()
