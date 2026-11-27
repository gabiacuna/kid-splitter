from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
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
    PreferenceMatchOut, RematchRequest, ColumnNoteOut, CandidateOut, NameSplitOut,
    ExistingUpdated, SkippedPreferenceOut,
)
from ..services.csv_import import (
    parse_csv_preview, Candidate, ExistingStudent, ImportFormatError, NameIndex, NAME_ORDERS,
    PreferenceMatchResult, PreferenceOwner, match_preference, plan_preference_pairs, row_key,
)

router = APIRouter(tags=["students"])

MAX_CSV_BYTES = 5 * 1024 * 1024  # 5 MB

# What browsers report for a .csv: Excel on Windows registers it as vnd.ms-excel, some
# systems send text/plain or a generic binary type.
CSV_CONTENT_TYPES = {"text/csv", "application/csv", "text/x-csv", "application/x-csv", "text/comma-separated-values"}
GENERIC_CONTENT_TYPES = {"application/vnd.ms-excel", "text/plain", "application/octet-stream", ""}


def is_csv_upload(content_type: str | None, filename: str | None) -> bool:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in CSV_CONTENT_TYPES:
        return True
    return ct in GENERIC_CONTENT_TYPES and (filename or "").lower().endswith((".csv", ".txt"))


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


def _candidate_out(c: Candidate) -> CandidateOut:
    return CandidateOut(key=c.key, display=c.display, source=c.source, row_index=c.row_index)


def _match_out(m: PreferenceMatchResult) -> PreferenceMatchOut:
    return PreferenceMatchOut(
        name=m.name, status=m.status, matched_key=m.matched_key, matched_display=m.matched_display,
        suggestions=[_candidate_out(c) for c in m.suggestions],
    )


def _row_candidates(rows) -> list[Candidate]:
    """Upload rows as match candidates, keyed by row so a student can't match themself."""
    return [Candidate(key=row_key(r.row_index), first=r.first_name.strip(), last=r.last_name.strip()) for r in rows]


async def _existing_students(db: AsyncSession, cohort_id: str) -> list[ExistingStudent]:
    rows = await db.execute(
        select(Student.id, Student.first_name, Student.last_name, Student.gender, Student.tags)
        .where(Student.cohort_id == cohort_id)
    )
    return [ExistingStudent(sid, fn, ln, g, list(t or [])) for sid, fn, ln, g, t in rows.all()]


async def _existing_candidates(db: AsyncSession, cohort_id: str) -> list[Candidate]:
    return [Candidate(key=e.id, first=e.first, last=e.last) for e in await _existing_students(db, cohort_id)]


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
    name_order: str = Form("surname_first"),
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    if not is_csv_upload(file.content_type, file.filename):
        raise HTTPException(status_code=415, detail={"code": "not_csv", "message": "File must be CSV"})
    if name_order not in NAME_ORDERS:
        raise HTTPException(status_code=422, detail={"code": "bad_name_order", "message": "Unknown name_order"})

    data = await file.read()
    if len(data) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail={"code": "too_large", "message": "File exceeds 5 MB limit"})

    existing = await _existing_students(db, cohort.id)
    try:
        preview = await parse_csv_preview(data, existing, name_order)
    except ImportFormatError as e:
        raise HTTPException(status_code=422, detail={"code": e.code, "message": str(e), **e.params})

    rows = preview.rows
    # Exact duplicates stay out of the index: their twin (existing student or earlier row) is in it.
    index = NameIndex(
        [Candidate(key=e.id, first=e.first, last=e.last) for e in existing]
        + _row_candidates(r for r in rows if r.importable)
    )

    preview_rows = []
    matched = unresolved = 0
    for r in rows:
        prefs = []
        for name in r.preferences:
            m = match_preference(name, index, self_key=r.owner_key)
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
            status_code=r.status_code,
            status_params=r.status_params,
            importable=r.importable,
            existing_student_id=r.existing_student_id,
            preferences=prefs,
        ))

    ok_count = sum(1 for r in preview_rows if r.importable)
    ns = preview.name_split
    return ImportPreviewResponse(
        rows=preview_rows,
        total=len(preview_rows),
        ok_count=ok_count,
        error_count=len(preview_rows) - ok_count,
        preferences_matched=matched,
        preferences_unresolved=unresolved,
        column_notes=[
            ColumnNoteOut(column=n.column, action=n.action, detail=n.detail, code=n.code, params=n.params)
            for n in preview.column_notes
        ],
        name_split=NameSplitOut(**ns.__dict__) if ns else None,
    )


@router.post("/cohorts/{cohort_id}/students/import/rematch", response_model=PreferenceMatchOut)
async def import_rematch(
    body: RematchRequest,
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    """Re-resolve one preference name after the teacher edits it in the preview."""
    index = NameIndex(await _existing_candidates(db, cohort.id) + _row_candidates(r for r in body.rows if r.importable))
    return _match_out(match_preference(body.name, index, self_key=row_key(body.self_row_index)))


@router.post("/cohorts/{cohort_id}/students/import/confirm", response_model=ImportConfirmResponse, status_code=201)
async def import_confirm(
    body: ImportConfirmRequest,
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    existing = {e.id: e for e in await _existing_students(db, cohort.id)}
    students: list[Student] = []
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

    # Keys come straight from the preview; nothing is re-matched by name here.
    row_to_student = {row_key(row.row_index): s.id for s, row in zip(students, body.students)}
    owners = [
        PreferenceOwner(s.id, f"{s.first_name} {s.last_name}", row.preference_keys)
        for s, row in zip(students, body.students)
    ]
    for ep in body.existing_preferences:
        e = existing.get(ep.student_id)
        if e is None:
            continue  # not this cohort's student: ignore rather than fail the whole import
        owners.append(PreferenceOwner(e.id, f"{e.first} {e.last}", ep.preference_keys, existing=True))

    existing_pairs = {
        frozenset(p) for p in (await db.execute(
            select(BinaryConstraint.student_a_id, BinaryConstraint.student_b_id)
            .where(BinaryConstraint.cohort_id == cohort.id)
        )).all()
    }
    plan = plan_preference_pairs(owners, row_to_student, set(existing), existing_pairs)
    for a, b in plan.pairs:
        db.add(BinaryConstraint(
            cohort_id=cohort.id,
            student_a_id=a,
            student_b_id=b,
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
        constraints_created=len(plan.pairs),
        existing_updated=[
            ExistingUpdated(student_id=sid, display=f"{existing[sid].first} {existing[sid].last}", constraints_created=n)
            for sid, n in plan.per_existing.items()
        ],
        skipped_preferences=[SkippedPreferenceOut(**sk.__dict__) for sk in plan.skipped],
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
