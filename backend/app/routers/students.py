from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db import get_db
from ..dependencies import current_teacher, get_cohort_or_403
from ..models.cohort import Cohort
from ..models.student import Student
from ..models.teacher import Teacher
from ..schemas.student import (
    StudentCreate, StudentUpdate, StudentOut,
    ImportConfirmRequest, ImportPreviewRow, ImportPreviewResponse,
)
from ..services.csv_import import parse_csv_preview

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

    existing = await db.execute(
        select(Student.first_name, Student.last_name).where(Student.cohort_id == cohort.id)
    )
    existing_names = {
        f"{fn.lower()} {ln.lower()}" for fn, ln in existing.all()
    }

    try:
        rows = await parse_csv_preview(data, existing_names)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    preview_rows = [
        ImportPreviewRow(
            row_index=r.row_index,
            first_name=r.first_name,
            last_name=r.last_name,
            tags=r.tags,
            status=r.status,
            status_message=r.status_message,
        )
        for r in rows
    ]
    ok_count = sum(1 for r in preview_rows if r.status == "ok")
    return ImportPreviewResponse(
        rows=preview_rows,
        total=len(preview_rows),
        ok_count=ok_count,
        error_count=len(preview_rows) - ok_count,
    )


@router.post("/cohorts/{cohort_id}/students/import/confirm", response_model=list[StudentOut], status_code=201)
async def import_confirm(
    body: ImportConfirmRequest,
    cohort: Cohort = Depends(get_cohort_or_403),
    db: AsyncSession = Depends(get_db),
):
    students = []
    for row in body.students:
        s = Student(
            cohort_id=cohort.id,
            first_name=row.first_name,
            last_name=row.last_name,
            tags=row.tags,
            import_source="csv",
        )
        db.add(s)
        students.append(s)

    await db.commit()
    for s in students:
        await db.refresh(s)
    return [StudentOut.model_validate(s) for s in students]


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
