import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..db import get_db
from ..dependencies import current_teacher, get_cohort_or_403
from ..models.cohort import Cohort
from ..models.student import Student
from ..models.constraint import BinaryConstraint, UnaryConstraint
from ..models.solution import Solution, ClassAssignment
from ..models.teacher import Teacher
from ..schemas.solve import SolveRequest, SolveResponse, SolutionOut, SolutionDetailOut, SolverMetadata, AssignmentOut
from ..schemas.constraint import ContradictionOut
from ..services.solver import SolverInput, run_solver
from ..services.validator import detect_contradictions

logger = logging.getLogger(__name__)
router = APIRouter(tags=["solve"])
limiter = Limiter(key_func=lambda request: request.state.teacher_id if hasattr(request.state, "teacher_id") else get_remote_address(request))
_executor = ThreadPoolExecutor(max_workers=4)

WEIGHT_SCALE = 100


def _solution_out(sol: Solution) -> SolutionOut:
    meta = sol.solver_metadata or {}
    return SolutionOut(
        id=sol.id,
        cohort_id=sol.cohort_id,
        label=sol.label or "",
        score=sol.score or 0.0,
        hard_violations=sol.hard_violations or 0,
        soft_violations=sol.soft_violations or 0,
        share_enabled=sol.share_enabled,
        solver_metadata=SolverMetadata(
            wall_time_s=meta.get("wall_time_s", 0.0),
            objective_value=meta.get("objective_value"),
            status=meta.get("status", "UNKNOWN"),
        ),
        created_at=sol.created_at,
    )


@router.post("/cohorts/{cohort_id}/solve", response_model=SolveResponse, status_code=201)
@limiter.limit("10/hour", key_func=lambda request: getattr(request.state, "teacher_id", get_remote_address(request)))
async def solve(
    request: Request,
    body: SolveRequest,
    cohort: Cohort = Depends(get_cohort_or_403),
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    total_students = await db.scalar(
        select(func.count(Student.id)).where(Student.cohort_id == cohort.id)
    ) or 0

    if total_students <= body.num_classes:
        raise HTTPException(status_code=422, detail="total_students must be greater than num_classes")

    binary = (await db.execute(
        select(BinaryConstraint).where(BinaryConstraint.cohort_id == cohort.id)
    )).scalars().all()
    unary = (await db.execute(
        select(UnaryConstraint).where(UnaryConstraint.cohort_id == cohort.id)
    )).scalars().all()

    contradictions = detect_contradictions(list(binary), body.num_classes, total_students)
    hard = [c for c in contradictions if c.type != "soft_warning"]
    if hard:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Hard contradictions prevent solving",
                "contradictions": [
                    {"type": c.type, "message": c.message, "student_ids": c.student_ids}
                    for c in hard
                ],
            },
        )

    students = (await db.execute(
        select(Student).where(Student.cohort_id == cohort.id)
    )).scalars().all()

    student_ids = [s.id for s in students]
    tags_map = {s.id: (s.tags or []) for s in students}

    inp = SolverInput(
        student_ids=student_ids,
        tags_map=tags_map,
        binary_constraints=list(binary),
        unary_constraints=list(unary),
        num_classes=body.num_classes,
    )

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(_executor, run_solver, inp)

    feasible_results = [r for r in results if r.feasible]
    if not feasible_results:
        raise HTTPException(status_code=422, detail="Solver could not find a feasible solution")

    persisted: list[Solution] = []
    for result in feasible_results:
        if result.hard_violations if hasattr(result, "hard_violations") else False:
            logger.error("Solver returned hard violations for variant %s — skipping persist", result.label)
            continue

        score = (result.objective_value or 0) / WEIGHT_SCALE
        sol = Solution(
            cohort_id=cohort.id,
            label=result.label,
            score=score,
            hard_violations=0,
            soft_violations=result.soft_violations,
            share_enabled=False,
            solver_metadata={
                "wall_time_s": result.wall_time_s,
                "objective_value": result.objective_value,
                "status": result.status,
            },
        )
        db.add(sol)
        await db.flush()

        for assignment in result.assignments:
            db.add(ClassAssignment(
                solution_id=sol.id,
                student_id=assignment["student_id"],
                class_number=assignment["class_number"],
            ))

        persisted.append(sol)

    await db.commit()
    for sol in persisted:
        await db.refresh(sol)

    return SolveResponse(solutions=[_solution_out(s) for s in persisted])


@router.get("/cohorts/{cohort_id}/solutions", response_model=list[SolutionOut])
async def list_solutions(
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    solutions = (await db.execute(
        select(Solution)
        .where(Solution.cohort_id == cohort.id)
        .order_by(Solution.created_at.desc())
    )).scalars().all()
    return [_solution_out(s) for s in solutions]


@router.get("/solutions/{solution_id}", response_model=SolutionDetailOut)
async def get_solution(
    solution_id: str,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    sol = await db.get(Solution, solution_id)
    if not sol:
        raise HTTPException(status_code=404)

    cohort = await db.scalar(
        select(Cohort).where(Cohort.id == sol.cohort_id, Cohort.teacher_id == teacher.id)
    )
    if not cohort:
        raise HTTPException(status_code=403)

    assignments = (await db.execute(
        select(ClassAssignment).where(ClassAssignment.solution_id == sol.id)
    )).scalars().all()

    out = _solution_out(sol)
    return SolutionDetailOut(
        **out.model_dump(),
        assignments=[AssignmentOut(student_id=a.student_id, class_number=a.class_number) for a in assignments],
    )


@router.delete("/solutions/{solution_id}", status_code=204)
async def delete_solution(
    solution_id: str,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    sol = await db.get(Solution, solution_id)
    if not sol:
        raise HTTPException(status_code=404)

    cohort = await db.scalar(
        select(Cohort).where(Cohort.id == sol.cohort_id, Cohort.teacher_id == teacher.id)
    )
    if not cohort:
        raise HTTPException(status_code=403)

    await db.delete(sol)
    await db.commit()
