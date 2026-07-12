from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from math import ceil

from ..db import get_db
from ..dependencies import current_teacher, get_cohort_or_403
from ..models.cohort import Cohort
from ..models.student import Student
from ..models.constraint import BinaryConstraint, UnaryConstraint
from ..models.teacher import Teacher
from ..schemas.constraint import (
    BinaryConstraintCreate, BinaryConstraintUpdate, BinaryConstraintOut,
    UnaryConstraintCreate, UnaryConstraintUpdate, UnaryConstraintOut,
    ConstraintListOut, ValidationOut, ContradictionOut,
)
from ..services.validator import detect_contradictions

router = APIRouter(tags=["constraints"])


async def _verify_constraint_ownership(
    constraint,
    teacher: Teacher,
    db: AsyncSession,
) -> None:
    cohort = await db.scalar(
        select(Cohort).where(
            Cohort.id == constraint.cohort_id,
            Cohort.teacher_id == teacher.id,
        )
    )
    if not cohort:
        raise HTTPException(status_code=403)


async def _student_in_cohort(student_id: str, cohort_id: str, db: AsyncSession) -> bool:
    result = await db.scalar(
        select(Student.id).where(Student.id == student_id, Student.cohort_id == cohort_id)
    )
    return result is not None


@router.get("/cohorts/{cohort_id}/constraints", response_model=ConstraintListOut)
async def list_constraints(
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    binary = (await db.execute(
        select(BinaryConstraint).where(BinaryConstraint.cohort_id == cohort.id)
    )).scalars().all()
    unary = (await db.execute(
        select(UnaryConstraint).where(UnaryConstraint.cohort_id == cohort.id)
    )).scalars().all()
    return ConstraintListOut(
        binary=[BinaryConstraintOut.model_validate(c) for c in binary],
        unary=[UnaryConstraintOut.model_validate(c) for c in unary],
    )


@router.post("/cohorts/{cohort_id}/constraints/binary", response_model=BinaryConstraintOut, status_code=201)
async def add_binary_constraint(
    body: BinaryConstraintCreate,
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    for sid in (body.student_a_id, body.student_b_id):
        if not await _student_in_cohort(sid, cohort.id, db):
            raise HTTPException(status_code=422, detail="Student not found in this cohort")

    c = BinaryConstraint(
        cohort_id=cohort.id,
        student_a_id=body.student_a_id,
        student_b_id=body.student_b_id,
        type=body.type,
        is_hard=body.is_hard,
        weight=body.weight,
        notes=body.notes,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return BinaryConstraintOut.model_validate(c)


@router.post("/cohorts/{cohort_id}/constraints/unary", response_model=UnaryConstraintOut, status_code=201)
async def add_unary_constraint(
    body: UnaryConstraintCreate,
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    if not await _student_in_cohort(body.student_id, cohort.id, db):
        raise HTTPException(status_code=422, detail="Student not found in this cohort")

    c = UnaryConstraint(
        cohort_id=cohort.id,
        student_id=body.student_id,
        type=body.type,
        tag=body.tag,
        parameter=body.parameter,
        is_hard=body.is_hard,
        weight=body.weight,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return UnaryConstraintOut.model_validate(c)


@router.put("/constraints/binary/{constraint_id}", response_model=BinaryConstraintOut)
async def update_binary_constraint(
    constraint_id: str,
    body: BinaryConstraintUpdate,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(BinaryConstraint, constraint_id)
    if not c:
        raise HTTPException(status_code=403)
    await _verify_constraint_ownership(c, teacher, db)

    if body.type is not None:
        c.type = body.type
    if body.is_hard is not None:
        c.is_hard = body.is_hard
    if body.weight is not None:
        c.weight = body.weight
    if body.notes is not None:
        c.notes = body.notes

    await db.commit()
    await db.refresh(c)
    return BinaryConstraintOut.model_validate(c)


@router.put("/constraints/unary/{constraint_id}", response_model=UnaryConstraintOut)
async def update_unary_constraint(
    constraint_id: str,
    body: UnaryConstraintUpdate,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(UnaryConstraint, constraint_id)
    if not c:
        raise HTTPException(status_code=403)
    await _verify_constraint_ownership(c, teacher, db)

    if body.type is not None:
        c.type = body.type
    if body.tag is not None:
        c.tag = body.tag
    if body.parameter is not None:
        c.parameter = body.parameter
    if body.is_hard is not None:
        c.is_hard = body.is_hard
    if body.weight is not None:
        c.weight = body.weight

    await db.commit()
    await db.refresh(c)
    return UnaryConstraintOut.model_validate(c)


@router.delete("/constraints/binary/{constraint_id}", status_code=204)
async def delete_binary_constraint(
    constraint_id: str,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(BinaryConstraint, constraint_id)
    if not c:
        raise HTTPException(status_code=403)
    await _verify_constraint_ownership(c, teacher, db)
    await db.delete(c)
    await db.commit()


@router.delete("/constraints/unary/{constraint_id}", status_code=204)
async def delete_unary_constraint(
    constraint_id: str,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(UnaryConstraint, constraint_id)
    if not c:
        raise HTTPException(status_code=403)
    await _verify_constraint_ownership(c, teacher, db)
    await db.delete(c)
    await db.commit()


@router.get("/cohorts/{cohort_id}/constraints/validate", response_model=ValidationOut)
async def validate_constraints(
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    binary = (await db.execute(
        select(BinaryConstraint).where(BinaryConstraint.cohort_id == cohort.id)
    )).scalars().all()

    from sqlalchemy import func
    total_students = await db.scalar(
        select(func.count(Student.id)).where(Student.cohort_id == cohort.id)
    ) or 0

    contradictions = detect_contradictions(list(binary), cohort.num_classes, total_students)
    hard = [c for c in contradictions if c.type != "soft_warning"]
    return ValidationOut(
        has_contradictions=bool(hard),
        contradictions=[
            ContradictionOut(type=c.type, message=c.message, student_ids=c.student_ids)
            for c in contradictions
        ],
    )
