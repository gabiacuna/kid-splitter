# Router Spec — `cohorts.py`

> **Prereq:** Load `00_shared_context.md` first.  
> **File:** `backend/app/routers/cohorts.py`  
> **Dependencies used:** `get_db`, `current_teacher`, `get_cohort_or_403`

---

## Responsibility

Full CRUD for cohorts. Each cohort belongs to exactly one teacher. All queries are isolated by `teacher_id` — a teacher can never read or modify another teacher's cohorts.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/cohorts` | Required | List all cohorts for current teacher |
| POST | `/cohorts` | Required | Create new cohort |
| GET | `/cohorts/{id}` | Required | Get cohort detail + student count |
| PUT | `/cohorts/{id}` | Required | Update name, year, num_classes |
| DELETE | `/cohorts/{id}` | Required | Delete cohort + all children |

---

## SQLAlchemy model — `models/cohort.py`

```python
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Integer, ForeignKey, DateTime, func
from ..db import Base
import uuid

class Cohort(Base):
    __tablename__ = "cohorts"

    id:          Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    teacher_id:  Mapped[str] = mapped_column(String, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False)
    name:        Mapped[str] = mapped_column(String, nullable=False)
    year:        Mapped[int | None] = mapped_column(Integer, nullable=True)
    num_classes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at:  Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:  Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    students    = relationship("Student", back_populates="cohort", cascade="all, delete-orphan")
    solutions   = relationship("Solution", back_populates="cohort", cascade="all, delete-orphan")
```

---

## Pydantic schemas — `schemas/cohort.py`

### Request schemas

```python
from pydantic import BaseModel, field_validator
from typing import Optional

class CohortCreate(BaseModel):
    name:        str
    year:        Optional[int] = None
    num_classes: int

    @field_validator("name")
    @classmethod
    def name_clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        if len(v) > 200:
            raise ValueError("name too long")
        return v

    @field_validator("num_classes")
    @classmethod
    def valid_num_classes(cls, v: int) -> int:
        if v < 2 or v > 20:
            raise ValueError("num_classes must be between 2 and 20")
        return v

    @field_validator("year")
    @classmethod
    def valid_year(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 2000 or v > 2100):
            raise ValueError("year out of range")
        return v

class CohortUpdate(BaseModel):
    name:        Optional[str] = None
    year:        Optional[int] = None
    num_classes: Optional[int] = None
    # Same validators as CohortCreate apply when fields are provided
```

### Response schemas

```python
from datetime import datetime

class CohortOut(BaseModel):
    id:            str
    name:          str
    year:          Optional[int]
    num_classes:   int
    student_count: int        # computed: SELECT COUNT(*) FROM students WHERE cohort_id = ...
    created_at:    datetime
    updated_at:    datetime

    model_config = {"from_attributes": True}

class CohortListOut(BaseModel):
    cohorts: list[CohortOut]
```

### Field summary

| Schema | Field | Type | Required | Validation |
|---|---|---|---|---|
| CohortCreate | name | str | ✅ | Stripped, non-empty, max 200 chars |
| CohortCreate | year | int | ❌ | 2000–2100 if provided |
| CohortCreate | num_classes | int | ✅ | 2–20 inclusive |
| CohortUpdate | name | str | ❌ | Same as above if provided |
| CohortUpdate | year | int | ❌ | Same as above if provided |
| CohortUpdate | num_classes | int | ❌ | 2–20 if provided |
| CohortOut | student_count | int | — | Computed at query time |

---

## Business logic

### `GET /cohorts`

1. Query `cohorts` filtered by `teacher_id = current_teacher.id`.
2. For each cohort, include a `student_count` via a subquery or joined count.
3. Return `CohortListOut`.

```python
from sqlalchemy import select, func
from ..models.student import Student

stmt = (
    select(Cohort, func.count(Student.id).label("student_count"))
    .outerjoin(Student, Student.cohort_id == Cohort.id)
    .where(Cohort.teacher_id == teacher.id)
    .group_by(Cohort.id)
    .order_by(Cohort.created_at.desc())
)
```

### `POST /cohorts`

1. Validate body as `CohortCreate`.
2. Insert `Cohort` with `teacher_id = current_teacher.id`.
3. Return `201` with `CohortOut` (student_count = 0).

### `GET /cohorts/{id}`

1. Use `get_cohort_or_403` dependency — it verifies ownership and returns the `Cohort` or raises `403`.
2. Compute `student_count`.
3. Return `CohortOut`.

### `PUT /cohorts/{id}`

1. Use `get_cohort_or_403`.
2. Apply only the fields present in `CohortUpdate` (partial update — ignore `None` fields).
3. If `num_classes` is being changed and solutions exist for this cohort, include a warning in the response:
   ```json
   {"cohort": {...}, "warning": "Changing class count requires a new solve. Existing solutions remain valid."}
   ```
4. Return `200` with updated `CohortOut`.

### `DELETE /cohorts/{id}`

1. Use `get_cohort_or_403`.
2. Delete the cohort. `ON DELETE CASCADE` propagates to students → constraints → solutions → class_assignments.
3. Return `204 No Content`.

---

## DO NOTs

- **Do not** query cohorts without `teacher_id` filter — even for internal lookups.
- **Do not** silently resolve `num_classes` on `PUT` — if the teacher changes it, warn that existing solutions are stale but do NOT delete them automatically.
- **Do not** compute `student_count` with a Python-side `len()` after loading all student objects — use a SQL `COUNT` to keep it efficient.
- **Do not** return a `403` message that reveals whether the cohort ID exists at all (e.g. "cohort not found" vs "not your cohort" — always return `403` for both cases when ownership fails).
