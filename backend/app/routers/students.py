from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db import get_db
from ..dependencies import current_teacher, get_cohort_or_403
from ..models.cohort import Cohort
from ..models.student import Student
from ..models.teacher import Teacher
from ..models.constraint import BinaryConstraint
from ..schemas.student import (
    StudentCreate, StudentUpdate, StudentOut,
    ImportConfirmRequest, ImportConfirmResponse, ImportPreviewRow, ImportPreviewResponse,
    PreferenceMatchOut, RematchRequest, ColumnNoteOut,
)
from ..services.csv_import import (
    parse_csv_preview, IMPORTABLE_STATUSES, Candidate, NameIndex, PreferenceMatchResult, match_preference,
)

router = APIRouter(tags=["students"])

MAX_CSV_BYTES = 5 * 1024 * 1024  # 5 MB


async def _verify_student_ownership(
    student_id: str,
    teacher: Teacher,
    db: AsyncSession,
) -> Student:
    student = await db.scalar(
        select(Student)
        .join(Cohort, Cohort.id == Student.cohort_id)
        .where(Student.id == student_id, Cohort.teacher_id == teacher.id)
    )
    if not student:
        raise HTTPException(status_code=403)
    return student


def _match_out(m: PreferenceMatchResult) -> PreferenceMatchOut:
    return PreferenceMatchOut(name=m.name, status=m.status, matched_display=m.matched_display, suggestions=m.suggestions)


def _row_candidates(rows) -> list[Candidate]:
    """Upload rows as match candidates, keyed by row so a student can't match themself."""
    return [Candidate(key=f"row:{r.row_index}", first=r.first_name.strip(), last=r.last_name.strip()) for r in rows]


async def _existing_candidates(db: AsyncSession, cohort_id: str) -> list[Candidate]:
    rows = await db.execute(
        select(Student.id, Student.first_name, Student.last_name).where(Student.cohort_id == cohort_id)
    )
    return [Candidate(key=sid, first=fn, last=ln) for sid, fn, ln in rows.all()]


@router.get("/cohorts/{cohort_id}/students", response_model=list[StudentOut])
async def list_students(
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Student)
        .where(Student.cohort_id == cohort.id)
        .order_by(Student.last_name, Student.first_name)
    )
    return [StudentOut.model_validate(s) for s in result.scalars()]


@router.post("/cohorts/{cohort_id}/students", response_model=StudentOut, status_code=201)
async def add_student(
    body: StudentCreate,
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    student = Student(
        cohort_id=cohort.id,
        first_name=body.first_name,
        last_name=body.last_name,
        tags=body.tags,
        gender=body.gender,
        import_source="manual",
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)
    return StudentOut.model_validate(student)


@router.post("/cohorts/{cohort_id}/students/import", response_model=ImportPreviewResponse)
async def import_preview(
    file: UploadFile = File(...),
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in ("text/csv", "application/csv"):
        raise HTTPException(status_code=415, detail="File must be CSV")

    data = await file.read()
    if len(data) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 5 MB limit")

    existing_students = await _existing_candidates(db, cohort.id)
    existing_names = {
        f"{c.first.lower()} {c.last.lower()}" for c in existing_students
    }

    try:
        preview = await parse_csv_preview(data, existing_names)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    rows = preview.rows
    index = NameIndex(existing_students + _row_candidates(r for r in rows if r.status in IMPORTABLE_STATUSES))

    preview_rows = []
    matched = unresolved = 0
    for r in rows:
        prefs = []
        for name in r.preferences:
            m = match_preference(name, index, self_key=f"row:{r.row_index}")
            prefs.append(_match_out(m))
            if m.status == "matched":
                matched += 1
            else:
                unresolved += 1
        preview_rows.append(ImportPreviewRow(
            row_index=r.row_index,
            first_name=r.first_name,
            last_name=r.last_name,
            tags=r.tags,
            gender=r.gender,
            status=r.status,
            status_message=r.status_message,
            importable=r.status in IMPORTABLE_STATUSES,
            preferences=prefs,
        ))

    ok_count = sum(1 for r in preview_rows if r.importable)
    return ImportPreviewResponse(
        rows=preview_rows,
        total=len(preview_rows),
        ok_count=ok_count,
        error_count=len(preview_rows) - ok_count,
        preferences_matched=matched,
        preferences_unresolved=unresolved,
        column_notes=[ColumnNoteOut(column=n.column, action=n.action, detail=n.detail) for n in preview.column_notes],
    )


@router.post("/cohorts/{cohort_id}/students/import/rematch", response_model=PreferenceMatchOut)
async def import_rematch(
    body: RematchRequest,
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    """Re-resolve one preference name after the teacher edits it in the preview."""
    index = NameIndex(await _existing_candidates(db, cohort.id) + _row_candidates(r for r in body.rows if r.importable))
    return _match_out(match_preference(body.name, index, self_key=f"row:{body.self_row_index}"))


@router.post("/cohorts/{cohort_id}/students/import/confirm", response_model=ImportConfirmResponse, status_code=201)
async def import_confirm(
    body: ImportConfirmRequest,
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    existing = await _existing_candidates(db, cohort.id)
    students = []
    for row in body.students:
        s = Student(
            cohort_id=cohort.id,
            first_name=row.first_name,
            last_name=row.last_name,
            tags=row.tags,
            gender=row.gender,
            import_source="csv",
        )
        db.add(s)
        students.append(s)
    await db.flush()  # assign ids before resolving preferences

    # Preferences become soft "together" constraints. Names are resolved again here
    # (the client only sends names) against the same pool the preview used.
    index = NameIndex(existing + [Candidate(key=s.id, first=s.first_name, last=s.last_name) for s in students])
    existing_pairs = {
        frozenset(p) for p in (await db.execute(
            select(BinaryConstraint.student_a_id, BinaryConstraint.student_b_id)
            .where(BinaryConstraint.cohort_id == cohort.id)
        )).all()
    }
    new_pairs: set[frozenset[str]] = set()
    for s, row in zip(students, body.students):
        for name in row.preferences:
            m = match_preference(name, index, self_key=s.id)
            if m.status != "matched" or not m.matched_key:
                continue
            pair = frozenset((s.id, m.matched_key))
            if pair in existing_pairs or pair in new_pairs:
                continue  # mutual listings and pre-existing rules produce one constraint
            new_pairs.add(pair)
            db.add(BinaryConstraint(
                cohort_id=cohort.id,
                student_a_id=s.id,
                student_b_id=m.matched_key,
                type="together",
                is_hard=False,
                weight=1.0,
                notes="From CSV import",
            ))

    await db.commit()
    for s in students:
        await db.refresh(s)
    return ImportConfirmResponse(
        students=[StudentOut.model_validate(s) for s in students],
        constraints_created=len(new_pairs),
    )


@router.put("/students/{student_id}", response_model=StudentOut)
async def update_student(
    student_id: str,
    body: StudentUpdate,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    student = await _verify_student_ownership(student_id, teacher, db)

    if body.first_name is not None:
        student.first_name = body.first_name
    if body.last_name is not None:
        student.last_name = body.last_name
    if body.tags is not None:
        student.tags = body.tags
    # Explicit null is a real write ("unknown"), so test presence, not value.
    if "gender" in body.model_fields_set:
        student.gender = body.gender

    await db.commit()
    await db.refresh(student)
    return StudentOut.model_validate(student)


@router.delete("/students/{student_id}", status_code=204)
async def delete_student(
    student_id: str,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
):
    student = await _verify_student_ownership(student_id, teacher, db)
    await db.delete(student)
    await db.commit()
