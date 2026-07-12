# Router Spec — `constraints.py`

> **Prereq:** Load `00_shared_context.md` first.  
> **File:** `backend/app/routers/constraints.py`  
> **Dependencies used:** `get_db`, `current_teacher`, `get_cohort_or_403`  
> **Services used:** `services/validator.py`

---

## Responsibility

CRUD for binary constraints (student-pair rules) and unary constraints (single-student environment rules), plus a pre-solve contradiction validator.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/cohorts/{id}/constraints` | Required | List all binary + unary constraints |
| POST | `/cohorts/{id}/constraints/binary` | Required | Add binary constraint |
| POST | `/cohorts/{id}/constraints/unary` | Required | Add unary constraint |
| PUT | `/constraints/binary/{id}` | Required | Update type / is_hard / weight / notes |
| PUT | `/constraints/unary/{id}` | Required | Update type / parameter / is_hard / weight |
| DELETE | `/constraints/binary/{id}` | Required | Remove binary constraint |
| DELETE | `/constraints/unary/{id}` | Required | Remove unary constraint |
| GET | `/cohorts/{id}/constraints/validate` | Required | Check for contradictions before solve |

---

## SQLAlchemy models — `models/constraint.py`

```python
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean, Float, Integer, ForeignKey, DateTime, func, CheckConstraint
from ..db import Base
import uuid

class BinaryConstraint(Base):
    __tablename__ = "binary_constraints"
    __table_args__ = (
        CheckConstraint("type IN ('together', 'separate')", name="binary_type_check"),
    )

    id:           Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    cohort_id:    Mapped[str] = mapped_column(String, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    student_a_id: Mapped[str] = mapped_column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    student_b_id: Mapped[str] = mapped_column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    type:         Mapped[str] = mapped_column(String, nullable=False)   # 'together' | 'separate'
    is_hard:      Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    weight:       Mapped[float] = mapped_column(Float, default=1.0)     # ignored when is_hard = True
    notes:        Mapped[str | None] = mapped_column(String, nullable=True)
    created_at:   Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:   Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UnaryConstraint(Base):
    __tablename__ = "unary_constraints"
    __table_args__ = (
        CheckConstraint(
            "type IN ('small_class','large_class','max_flagged_peers','max_conflict_peers')",
            name="unary_type_check"
        ),
    )

    id:         Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    cohort_id:  Mapped[str] = mapped_column(String, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    student_id: Mapped[str] = mapped_column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    type:       Mapped[str] = mapped_column(String, nullable=False)
    parameter:  Mapped[int | None] = mapped_column(Integer, nullable=True)  # required for max_* types
    is_hard:    Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    weight:     Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

---

## Pydantic schemas — `schemas/constraint.py`

### Request schemas

```python
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, Literal

BINARY_TYPES = Literal["together", "separate"]
UNARY_TYPES  = Literal["small_class", "large_class", "max_flagged_peers", "max_conflict_peers"]

class BinaryConstraintCreate(BaseModel):
    student_a_id: str
    student_b_id: str
    type:         BINARY_TYPES
    is_hard:      bool = False
    weight:       float = 1.0
    notes:        Optional[str] = None

    @field_validator("weight")
    @classmethod
    def valid_weight(cls, v: float) -> float:
        if v < 0.1 or v > 10.0:
            raise ValueError("weight must be between 0.1 and 10.0")
        return v

    @model_validator(mode="after")
    def different_students(self):
        if self.student_a_id == self.student_b_id:
            raise ValueError("student_a_id and student_b_id must be different")
        return self

class BinaryConstraintUpdate(BaseModel):
    type:    Optional[BINARY_TYPES] = None
    is_hard: Optional[bool] = None
    weight:  Optional[float] = None
    notes:   Optional[str] = None

class UnaryConstraintCreate(BaseModel):
    student_id: str
    type:       UNARY_TYPES
    parameter:  Optional[int] = None
    is_hard:    bool = False
    weight:     float = 1.0

    @model_validator(mode="after")
    def parameter_required_for_max_types(self):
        if self.type in ("max_flagged_peers", "max_conflict_peers"):
            if self.parameter is None or self.parameter < 0:
                raise ValueError(f"parameter (>= 0) is required for type '{self.type}'")
        return self

    @field_validator("weight")
    @classmethod
    def valid_weight(cls, v: float) -> float:
        if v < 0.1 or v > 10.0:
            raise ValueError("weight must be between 0.1 and 10.0")
        return v

class UnaryConstraintUpdate(BaseModel):
    type:      Optional[UNARY_TYPES] = None
    parameter: Optional[int] = None
    is_hard:   Optional[bool] = None
    weight:    Optional[float] = None
```

### Response schemas

```python
from datetime import datetime

class BinaryConstraintOut(BaseModel):
    id:           str
    cohort_id:    str
    student_a_id: str
    student_b_id: str
    type:         str
    is_hard:      bool
    weight:       float
    notes:        Optional[str]
    created_at:   datetime

    model_config = {"from_attributes": True}

class UnaryConstraintOut(BaseModel):
    id:         str
    cohort_id:  str
    student_id: str
    type:       str
    parameter:  Optional[int]
    is_hard:    bool
    weight:     float
    created_at: datetime

    model_config = {"from_attributes": True}

class ConstraintListOut(BaseModel):
    binary: list[BinaryConstraintOut]
    unary:  list[UnaryConstraintOut]

class ContradictionOut(BaseModel):
    type:    str   # 'direct_conflict' | 'cluster_overflow' | 'coloring_impossible' | 'soft_warning'
    message: str
    student_ids: list[str]  # the students involved

class ValidationOut(BaseModel):
    has_contradictions: bool
    contradictions:     list[ContradictionOut]
```

### Field summary

| Schema | Field | Type | Required | Validation |
|---|---|---|---|---|
| BinaryConstraintCreate | student_a_id | str | ✅ | Must differ from student_b_id |
| BinaryConstraintCreate | student_b_id | str | ✅ | Must differ from student_a_id |
| BinaryConstraintCreate | type | str | ✅ | `together` or `separate` |
| BinaryConstraintCreate | is_hard | bool | ❌ | Default false |
| BinaryConstraintCreate | weight | float | ❌ | 0.1–10.0; default 1.0 |
| UnaryConstraintCreate | student_id | str | ✅ | Must belong to cohort |
| UnaryConstraintCreate | type | str | ✅ | One of 4 valid values |
| UnaryConstraintCreate | parameter | int | Conditional | Required + ≥ 0 when type is `max_*` |
| UnaryConstraintCreate | weight | float | ❌ | 0.1–10.0; default 1.0 |

---

## Business logic

### `GET /cohorts/{id}/constraints`

1. Use `get_cohort_or_403`.
2. Query all `BinaryConstraint` and `UnaryConstraint` where `cohort_id = cohort.id`.
3. Return `ConstraintListOut`.

### `POST /cohorts/{id}/constraints/binary`

1. Use `get_cohort_or_403`.
2. Validate body as `BinaryConstraintCreate`.
3. **Verify student ownership:** both `student_a_id` and `student_b_id` must exist and belong to this `cohort_id`. If either fails → `422 {"detail": "Student not found in this cohort"}`.
4. Insert `BinaryConstraint` with `cohort_id` set from the URL parameter (not from the body).
5. Return `201` with `BinaryConstraintOut`.

### `POST /cohorts/{id}/constraints/unary`

1. Use `get_cohort_or_403`.
2. Validate body as `UnaryConstraintCreate`.
3. Verify `student_id` belongs to this cohort — same as above.
4. Insert `UnaryConstraint`.
5. Return `201` with `UnaryConstraintOut`.

### `PUT /constraints/binary/{id}`

1. Look up `BinaryConstraint` by `id`. Join through `cohort` to verify `teacher_id = current_teacher.id`. If not found or not owned → `403`.
2. Apply only the non-None fields from `BinaryConstraintUpdate`.
3. If `is_hard` is being set to `true`, `weight` is effectively ignored — but do not delete or zero it; keep it stored so it can be restored if `is_hard` is later set back to `false`.
4. Return `200` with `BinaryConstraintOut`.

### `PUT /constraints/unary/{id}`

Same ownership check as above, apply `UnaryConstraintUpdate` partially.

### `DELETE /constraints/binary/{id}` and `DELETE /constraints/unary/{id}`

1. Ownership check.
2. Delete row.
3. Return `204 No Content`.

### `GET /cohorts/{id}/constraints/validate`

1. Use `get_cohort_or_403`.
2. Load all **hard** binary constraints for the cohort.
3. Run contradiction checks via `services/validator.py` (see below).
4. Return `ValidationOut`.

> This endpoint should be called by the frontend before enabling the solve button. The solve endpoint also runs this internally and refuses to proceed if hard contradictions exist.

---

## `services/validator.py` — contradiction detection

```python
from dataclasses import dataclass

@dataclass
class Contradiction:
    type:        str
    message:     str
    student_ids: list[str]

def detect_contradictions(
    binary_constraints: list[BinaryConstraint],
    num_classes:        int,
    max_class_size:     int,
) -> list[Contradiction]:
    ...
```

### Checks to implement

| Check | Logic | Severity |
|---|---|---|
| Direct conflict | Same pair has both a hard `together` AND a hard `separate` constraint | Hard — blocks solve |
| Cluster overflow | BFS on hard `together` graph. If any connected component has more students than `max_class_size` (= `ceil(total / num_classes)`), it's impossible to fit them | Hard — blocks solve |
| Coloring impossible | Build a graph of hard `separate` pairs. If it requires more than `num_classes` colors (graph chromatic number), assignment is impossible. Use a greedy check — exact chromatic number is NP-hard but greedy is safe for this scale | Hard — blocks solve |
| Soft warning | A+B soft-together, B+C soft-together, A+C soft-separate — solver will handle via penalties, but warn the teacher | Soft — doesn't block solve |

**Important:** BFS cluster check uses `total_students // num_classes` as `min_size` and `ceil(total_students / num_classes)` as `max_size`. A together-cluster exceeding `max_size` is a hard contradiction.

---

## DO NOTs

- **Do not** allow `student_a_id == student_b_id` on a binary constraint — a student can't be constrained with themselves.
- **Do not** allow a constraint where either student belongs to a different cohort than the URL `cohort_id` — always verify both students are in the cohort.
- **Do not** zero out `weight` when `is_hard = true` — preserve it so it can be restored.
- **Do not** silently skip contradictions during solve — surface them to the teacher and block the solve endpoint.
- **Do not** run the full graph coloring on thousands of nodes — this dataset is 30–60 students, a greedy check is appropriate and safe.
- **Do not** trust that `cohort_id` on the constraint record in the DB is correct authority — always re-verify ownership through the teacher chain.
