# Router Spec — `students.py`

> **Prereq:** Load `00_shared_context.md` first.  
> **File:** `backend/app/routers/students.py`  
> **Dependencies used:** `get_db`, `current_teacher`, `get_cohort_or_403`  
> **Services used:** `services/csv_import.py`

---

## Responsibility

Manual add, update, delete, and CSV bulk import of students within a cohort. CSV import is a two-step preview/confirm flow — nothing is committed until the teacher explicitly confirms.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/cohorts/{id}/students` | Required | List all students in cohort |
| POST | `/cohorts/{id}/students` | Required | Add single student manually |
| POST | `/cohorts/{id}/students/import` | Required | Parse CSV → return preview (not committed) |
| POST | `/cohorts/{id}/students/import/confirm` | Required | Commit a previewed import |
| PUT | `/students/{id}` | Required | Update name or tags |
| DELETE | `/students/{id}` | Required | Remove student (cascades constraints) |

---

## SQLAlchemy model — `models/student.py`

```python
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, ARRAY, ForeignKey, DateTime, func
from ..db import Base
import uuid

class Student(Base):
    __tablename__ = "students"

    id:            Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    cohort_id:     Mapped[str] = mapped_column(String, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    first_name:    Mapped[str] = mapped_column(String, nullable=False)
    last_name:     Mapped[str] = mapped_column(String, nullable=False)
    tags:          Mapped[list[str]] = mapped_column(ARRAY(String), server_default="{}")
    import_source: Mapped[str | None] = mapped_column(String, nullable=True)  # 'csv' or 'manual'
    created_at:    Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:    Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    cohort = relationship("Cohort", back_populates="students")
```

---

## Pydantic schemas — `schemas/student.py`

### Request schemas

```python
from pydantic import BaseModel, field_validator
from typing import Optional
import re

TAG_RE = re.compile(r'^[a-zA-Z0-9\-]{1,30}$')

def validate_tags(tags: list[str]) -> list[str]:
    if len(tags) > 10:
        raise ValueError("Max 10 tags per student")
    for tag in tags:
        if not TAG_RE.match(tag):
            raise ValueError(f"Invalid tag '{tag}': alphanumeric + hyphens only, max 30 chars")
    return tags

def validate_name(v: str, field: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError(f"{field} is required")
    if len(v) > 100:
        raise ValueError(f"{field} max 100 characters")
    # Strip HTML — reject if any tags found
    if "<" in v or ">" in v:
        raise ValueError(f"{field} must not contain HTML")
    return v

class StudentCreate(BaseModel):
    first_name: str
    last_name:  str
    tags:       list[str] = []

    @field_validator("first_name")
    @classmethod
    def clean_first(cls, v): return validate_name(v, "first_name")

    @field_validator("last_name")
    @classmethod
    def clean_last(cls, v): return validate_name(v, "last_name")

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, v): return validate_tags(v)

class StudentUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name:  Optional[str] = None
    tags:       Optional[list[str]] = None
    # Same validators apply when fields are provided

class ImportConfirmRequest(BaseModel):
    # The client sends back the (possibly edited) preview rows to commit
    students: list[StudentCreate]
```

### Response schemas

```python
from datetime import datetime

class StudentOut(BaseModel):
    id:            str
    cohort_id:     str
    first_name:    str
    last_name:     str
    tags:          list[str]
    import_source: Optional[str]
    created_at:    datetime

    model_config = {"from_attributes": True}

class ImportPreviewRow(BaseModel):
    row_index:      int
    first_name:     str
    last_name:      str
    tags:           list[str]
    status:         str   # 'ok' | 'duplicate' | 'missing_name' | 'invalid_tag'
    status_message: Optional[str] = None

class ImportPreviewResponse(BaseModel):
    rows:        list[ImportPreviewRow]
    total:       int
    ok_count:    int
    error_count: int
```

### Field summary

| Schema | Field | Type | Required | Validation |
|---|---|---|---|---|
| StudentCreate | first_name | str | ✅ | Stripped, no HTML, max 100 chars |
| StudentCreate | last_name | str | ✅ | Stripped, no HTML, max 100 chars |
| StudentCreate | tags | list[str] | ❌ | Alphanumeric + hyphens, max 30 chars each, max 10 total |
| StudentUpdate | first_name | str | ❌ | Same as above if provided |
| StudentUpdate | last_name | str | ❌ | Same as above if provided |
| StudentUpdate | tags | list[str] | ❌ | Same as above if provided |
| ImportConfirmRequest | students | list[StudentCreate] | ✅ | Each row validated as StudentCreate |

---

## Business logic

### `GET /cohorts/{id}/students`

1. Use `get_cohort_or_403` to verify ownership.
2. Query all students where `cohort_id = cohort.id`, ordered by `last_name`, `first_name`.
3. Return list of `StudentOut`.

### `POST /cohorts/{id}/students`

1. Use `get_cohort_or_403`.
2. Validate body as `StudentCreate`.
3. Insert student with `import_source = 'manual'`.
4. Return `201` with `StudentOut`.

### `POST /cohorts/{id}/students/import`

Accepts `multipart/form-data` with a `file` field (CSV).

**Validation before parsing:**
- File size must be ≤ 5 MB — reject with `413` if exceeded.
- Content-type must be `text/csv` or `application/csv` — reject with `415` otherwise.

**Parsing (`services/csv_import.py`):**
1. Decode as UTF-8. Parse with Python `csv.DictReader`.
2. Expected columns: `first_name`, `last_name`, `tags` (comma-separated within the cell, e.g. `"needs-support,esl"`). Column names are case-insensitive; trim whitespace.
3. Reject any cell value that starts with `=`, `+`, `-`, or `@` (CSV injection) — mark that row as `invalid_tag` or `missing_name`.
4. For each row, detect duplicates: a duplicate is a student whose `first_name + last_name` (case-insensitive, trimmed) already exists in the cohort OR appears more than once in the uploaded file.
5. Cap at 500 rows — if the file exceeds 500 data rows, reject with `422 {"detail": "CSV exceeds 500 row limit"}`.
6. Return `ImportPreviewResponse` — **do not insert any rows yet**.

**Status values:**
| Status | Meaning |
|---|---|
| `ok` | Row is valid and not a duplicate |
| `duplicate` | Same full name exists in cohort or appears twice in upload |
| `missing_name` | `first_name` or `last_name` is blank |
| `invalid_tag` | A tag fails format validation or the cell starts with injection chars |

### `POST /cohorts/{id}/students/import/confirm`

1. Use `get_cohort_or_403`.
2. Accepts `ImportConfirmRequest` — the client sends back the (possibly edited) preview rows.
3. Re-validate every row with `StudentCreate` validators. Reject the entire batch with `422` if any row fails — do not partially commit.
4. Bulk-insert all rows with `import_source = 'csv'`.
5. Return `201` with the list of created `StudentOut`.

> **Important:** Re-validate on confirm. The client could have edited rows or sent a malformed payload — never trust the preview state.

### `PUT /students/{id}`

1. Look up student by `id`. Join to cohort to verify `teacher_id = current_teacher.id`. If not found or not owned → `403`.
2. Apply only the fields present in `StudentUpdate` (partial update).
3. Return `200` with updated `StudentOut`.

### `DELETE /students/{id}`

1. Ownership check as above.
2. Delete student. `ON DELETE CASCADE` removes associated `binary_constraints` and `unary_constraints` automatically.
3. Return `204 No Content`.

> **Note for frontend:** After deleting a student, the frontend should re-fetch the constraints list for the cohort — some constraints will have been silently removed by cascade.

---

## `services/csv_import.py` interface

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class PreviewRow:
    row_index:      int
    first_name:     str
    last_name:      str
    tags:           list[str]
    status:         str   # 'ok' | 'duplicate' | 'missing_name' | 'invalid_tag'
    status_message: Optional[str]

async def parse_csv_preview(
    file_bytes: bytes,
    existing_names: set[str],   # set of "firstname lastname" already in cohort (lowercase)
) -> list[PreviewRow]:
    ...
```

---

## DO NOTs

- **Do not** commit any rows during the `/import` (preview) step — only parse and return.
- **Do not** skip re-validation on `/import/confirm` — the client data must not be trusted.
- **Do not** partially commit an import batch — it's all-or-nothing to keep the DB consistent.
- **Do not** accept CSVs larger than 5 MB or with more than 500 rows — both are DoS vectors.
- **Do not** return `last_name` on public/share endpoints (this is a student endpoint only — still include it here since it's auth-protected).
- **Do not** silently drop CSV rows that fail validation — surface every error in the preview so the teacher can fix them.
- **Do not** accept cells starting with `=`, `+`, `-`, `@` — these are CSV injection payloads.
