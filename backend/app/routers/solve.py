import asyncio
from dataclasses import dataclass
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
from ..schemas.solve import SolveRequest, SolveResponse, SolutionOut, SolutionDetailOut, SolverMetadata, AssignmentOut, GenderSplit
from ..schemas.constraint import ContradictionOut
from ..services.solver import SolverInput, run_solver, evaluate_preferences
from ..services.validator import detect_contradictions, short_display_names

logger = logging.getLogger(__name__)
router = APIRouter(tags=["solve"])
limiter = Limiter(key_func=lambda request: request.state.teacher_id if hasattr(request.state, "teacher_id") else get_remote_address(request))
_executor = ThreadPoolExecutor(max_workers=4)



def _gender_split(
    assignments: list[tuple[str, int]],
    gender_map: dict[str, str | None],
) -> list[GenderSplit]:
    """Per-class boy/girl/unknown counts. Computed on read so it never goes stale
    when a student's gender is corrected after solving."""
    counts: dict[int, dict[str, int]] = {}
    for student_id, class_number in assignments:
        c = counts.setdefault(class_number, {"boy": 0, "girl": 0, "unknown": 0})
        c[gender_map.get(student_id) or "unknown"] += 1
    return [
        GenderSplit(class_number=k, boys=c["boy"], girls=c["girl"], unknown=c["unknown"])
        for k, c in sorted(counts.items())
    ]


async def _assignments_by_solution(db: AsyncSession, solution_ids: list[str]) -> dict[str, list[tuple[str, int]]]:
    out: dict[str, list[tuple[str, int]]] = {sid: [] for sid in solution_ids}
    if not solution_ids:
        return out
    rows = await db.execute(
        select(ClassAssignment.solution_id, ClassAssignment.student_id, ClassAssignment.class_number)
        .where(ClassAssignment.solution_id.in_(solution_ids))
    )
    for solution_id, student_id, class_number in rows.all():
        out[solution_id].append((student_id, class_number))
    return out


@dataclass
class _CohortContext:
    """Everything needed to describe any solution of a cohort, loaded once per request."""
    student_ids: list[str]
    tags_map:    dict[str, list[str]]
    gender_map:  dict[str, str | None]
    binary:      list
    unary:       list


async def _cohort_context(db: AsyncSession, cohort_id: str) -> _CohortContext:
    students = (await db.execute(
        select(Student.id, Student.tags, Student.gender).where(Student.cohort_id == cohort_id)
    )).all()
    binary = (await db.execute(select(BinaryConstraint).where(BinaryConstraint.cohort_id == cohort_id))).scalars().all()
    unary = (await db.execute(select(UnaryConstraint).where(UnaryConstraint.cohort_id == cohort_id))).scalars().all()
    return _CohortContext(
        student_ids=[s.id for s in students],
        tags_map={s.id: (s.tags or []) for s in students},
        gender_map={s.id: s.gender for s in students},
        binary=list(binary),
        unary=list(unary),
    )


def _solution_out(sol: Solution, assignments: list[tuple[str, int]], ctx: _CohortContext) -> SolutionOut:
    """Score, soft violations and gender split are computed on read against the cohort's
    current students and rules, so they never go stale after edits."""
    meta = sol.solver_metadata or {}
    num_classes = max((k for _, k in assignments), default=1)
    evaluation = evaluate_preferences(
        [{"student_id": s, "class_number": k} for s, k in assignments],
        SolverInput(ctx.student_ids, ctx.tags_map, ctx.binary, ctx.unary, num_classes),
    )
    return SolutionOut(
        id=sol.id,
        cohort_id=sol.cohort_id,
        label=sol.label or "",
        score=evaluation.score,
        hard_violations=sol.hard_violations or 0,
        soft_violations=evaluation.violations,
        share_enabled=sol.share_enabled,
        solver_metadata=SolverMetadata(
            wall_time_s=meta.get("wall_time_s", 0.0),
            objective_value=meta.get("objective_value"),
            status=meta.get("status", "UNKNOWN"),
        ),
        gender_split=_gender_split(assignments, ctx.gender_map),
        class_assignments=[AssignmentOut(student_id=s, class_number=k) for s, k in sorted(assignments, key=lambda a: (a[1], a[0]))],
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

    name_rows = (await db.execute(
        select(Student.id, Student.first_name, Student.last_name).where(Student.cohort_id == cohort.id)
    )).all()
    contradictions = detect_contradictions(
        list(binary), body.num_classes, total_students, short_display_names(name_rows)
    )
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
    gender_map = {s.id: s.gender for s in students}

    inp = SolverInput(
        student_ids=student_ids,
        tags_map=tags_map,
        binary_constraints=list(binary),
        unary_constraints=list(unary),
        num_classes=body.num_classes,
        gender_map=gender_map,
        balance_gender=cohort.balance_gender,
    )

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(_executor, run_solver, inp)

    feasible_results = [r for r in results if r.feasible]
    if not feasible_results:
        raise HTTPException(status_code=422, detail="Solver could not find a feasible solution")

    persisted: list[tuple[Solution, list[GenderSplit]]] = []
    for result in feasible_results:
        if result.hard_violations if hasattr(result, "hard_violations") else False:
            logger.error("Solver returned hard violations for variant %s — skipping persist", result.label)
            continue

        score = evaluate_preferences(result.assignments, inp).score
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

        persisted.append((sol, [(a["student_id"], a["class_number"]) for a in result.assignments]))

    await db.commit()
    for sol, _ in persisted:
        await db.refresh(sol)

    ctx = await _cohort_context(db, cohort.id)
    return SolveResponse(solutions=[_solution_out(s, asg, ctx) for s, asg in persisted])


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
    # Fixed number of queries regardless of solution count (no per-solution N+1).
    ctx = await _cohort_context(db, cohort.id)
    by_solution = await _assignments_by_solution(db, [s.id for s in solutions])
    return [_solution_out(s, by_solution[s.id], ctx) for s in solutions]


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

    ctx = await _cohort_context(db, cohort.id)
    out = _solution_out(sol, [(a.student_id, a.class_number) for a in assignments], ctx)
    return SolutionDetailOut(**out.model_dump())


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
