import asyncio
from dataclasses import dataclass
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..db import get_db
from ..dependencies import current_teacher, get_cohort_or_403, get_solution_or_403
from ..models.cohort import Cohort
from ..models.student import Student
from ..models.constraint import BinaryConstraint, UnaryConstraint
from ..models.solution import Solution, ClassAssignment
from ..models.teacher import Teacher
from ..schemas.solve import SolveRequest, SolveResponse, SolutionOut, SolverMetadata, AssignmentOut, GenderSplit
from ..services.solver import SolverInput, run_solver, evaluate_preferences
from ..services.export import XLSX_MEDIA_TYPE, build_roster_workbook, content_disposition, safe_filename_stem, VARIANT_NAMES
from ..services.validator import detect_conflicts, short_display_names

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


async def _load_cohort(db: AsyncSession, cohort_id: str) -> tuple[list[Student], list, list]:
    students = (await db.execute(select(Student).where(Student.cohort_id == cohort_id))).scalars().all()
    binary = (await db.execute(select(BinaryConstraint).where(BinaryConstraint.cohort_id == cohort_id))).scalars().all()
    unary = (await db.execute(select(UnaryConstraint).where(UnaryConstraint.cohort_id == cohort_id))).scalars().all()
    return list(students), list(binary), list(unary)


def _context_from(students: list[Student], binary: list, unary: list) -> _CohortContext:
    return _CohortContext(
        student_ids=[s.id for s in students],
        tags_map={s.id: (s.tags or []) for s in students},
        gender_map={s.id: s.gender for s in students},
        binary=binary,
        unary=unary,
    )


async def _cohort_context(db: AsyncSession, cohort_id: str) -> _CohortContext:
    return _context_from(*await _load_cohort(db, cohort_id))


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
    # One load of the cohort serves the pre-check, the solver and the response.
    students, binary, unary = await _load_cohort(db, cohort.id)
    if len(students) <= body.num_classes:
        raise HTTPException(status_code=422, detail="total_students must be greater than num_classes")

    loop = asyncio.get_running_loop()
    names = short_display_names((s.id, s.first_name, s.last_name) for s in students)
    groups = await loop.run_in_executor(
        _executor, detect_conflicts, binary, body.num_classes, len(students), names
    )
    hard = [g for g in groups if g.severity == "hard"]
    if hard:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Hard contradictions prevent solving",
                "conflicts": [g.explanation for g in hard],
            },
        )

    ctx = _context_from(students, binary, unary)
    inp = SolverInput(
        student_ids=ctx.student_ids,
        tags_map=ctx.tags_map,
        binary_constraints=binary,
        unary_constraints=unary,
        num_classes=body.num_classes,
        gender_map=ctx.gender_map,
        balance_gender=cohort.balance_gender,
    )

    results = await loop.run_in_executor(_executor, run_solver, inp)

    feasible_results = [r for r in results if r.feasible]
    if not feasible_results:
        raise HTTPException(status_code=422, detail="Solver could not find a feasible solution")

    persisted: list[tuple[Solution, list[tuple[str, int]]]] = []
    for result in feasible_results:
        # score/soft_violations columns are a snapshot; responses recompute them on read.
        evaluation = evaluate_preferences(result.assignments, inp)
        sol = Solution(
            cohort_id=cohort.id,
            label=result.label,
            score=evaluation.score,
            hard_violations=0,
            soft_violations=evaluation.violations,
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


@router.get("/solutions/{solution_id}", response_model=SolutionOut)
async def get_solution(
    owned: tuple[Solution, Cohort] = Depends(get_solution_or_403),
    db: AsyncSession = Depends(get_db),
):
    sol, cohort = owned
    assignments = (await _assignments_by_solution(db, [sol.id]))[sol.id]
    return _solution_out(sol, assignments, await _cohort_context(db, cohort.id))


@router.get("/solutions/{solution_id}/export.xlsx")
async def export_solution(
    owned: tuple[Solution, Cohort] = Depends(get_solution_or_403),
    db: AsyncSession = Depends(get_db),
):
    sol, cohort = owned

    # Same ordering as GET /cohorts/{id}/students within each class.
    rows = (await db.execute(
        select(ClassAssignment.class_number, Student.first_name, Student.last_name)
        .join(Student, Student.id == ClassAssignment.student_id)
        .where(ClassAssignment.solution_id == sol.id)
        .order_by(ClassAssignment.class_number, Student.last_name, Student.first_name)
    )).all()
    content = build_roster_workbook([(k, f"{first} {last}".strip()) for k, first, last in rows])

    variant = VARIANT_NAMES.get(sol.label or "", sol.label or "")
    stem = safe_filename_stem(f"{cohort.name} - {variant}".strip(" -"))
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": content_disposition(f"{stem}-class-list.xlsx")},
    )


@router.delete("/solutions/{solution_id}", status_code=204)
async def delete_solution(
    owned: tuple[Solution, Cohort] = Depends(get_solution_or_403),
    db: AsyncSession = Depends(get_db),
):
    sol, _ = owned
    await db.delete(sol)
    await db.commit()
