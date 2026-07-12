# Shared Context — Class Scheduler Backend

> **Load this file before every router spec.** All router specs assume this context and do not repeat it.

---

## Stack

| Layer | Choice |
|---|---|
| Language | Python 3.11+ |
| Framework | FastAPI (async) |
| ORM | SQLAlchemy 2.0 async (`AsyncSession`) |
| Migrations | Alembic |
| Auth | Supabase Auth — JWT validation via `python-jose` |
| DB | PostgreSQL 15 |
| Password hashing | `bcrypt` |
| Validation | Pydantic v2 |
| Rate limiting | `slowapi` |

---

## Project layout (backend only)

```
backend/app/
├── main.py               # FastAPI init, CORS, middleware, router registration
├── db.py                 # Async engine + session factory
├── dependencies.py       # Shared FastAPI dependencies (see below)
├── models/               # SQLAlchemy ORM models
│   ├── teacher.py
│   ├── cohort.py
│   ├── student.py
│   ├── constraint.py     # BinaryConstraint + UnaryConstraint
│   └── solution.py       # Solution + ClassAssignment
├── schemas/              # Pydantic v2 request/response schemas
├── routers/              # One file per feature domain
│   ├── auth.py
│   ├── cohorts.py
│   ├── students.py
│   ├── constraints.py
│   ├── solve.py
│   └── share.py
└── services/
    ├── solver.py
    ├── csv_import.py
    └── validator.py
```

---

## Database models

All tables have `created_at TIMESTAMPTZ DEFAULT now()` and `updated_at TIMESTAMPTZ DEFAULT now()` (updated via SQLAlchemy `onupdate`). Row-level isolation is enforced by always filtering on `teacher_id`. School is a text label only — no admin role.

### `teachers`

```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
email         TEXT UNIQUE NOT NULL
password_hash TEXT NOT NULL        -- bcrypt
school_name   TEXT NOT NULL        -- display label only
created_at    TIMESTAMPTZ DEFAULT now()
updated_at    TIMESTAMPTZ DEFAULT now()
```

### `cohorts`

```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE
name        TEXT NOT NULL
year        INTEGER
num_classes INTEGER NOT NULL       -- always resolved before solve; min 2
created_at  TIMESTAMPTZ DEFAULT now()
updated_at  TIMESTAMPTZ DEFAULT now()
```

### `students`

```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
cohort_id     UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE
first_name    TEXT NOT NULL
last_name     TEXT NOT NULL        -- NEVER exposed in share links
tags          TEXT[] DEFAULT '{}'  -- e.g. {needs-support, behavioural}
import_source TEXT                 -- 'csv' or 'manual'
created_at    TIMESTAMPTZ DEFAULT now()
updated_at    TIMESTAMPTZ DEFAULT now()
```

### `binary_constraints`

```sql
id           UUID PRIMARY KEY DEFAULT gen_random_uuid()
cohort_id    UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE
student_a_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE
student_b_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE
type         TEXT CHECK (type IN ('together', 'separate'))
is_hard      BOOLEAN NOT NULL DEFAULT false
weight       FLOAT DEFAULT 1.0    -- ignored when is_hard = true; range 0.1–10.0
notes        TEXT
created_at   TIMESTAMPTZ DEFAULT now()
updated_at   TIMESTAMPTZ DEFAULT now()
```

### `unary_constraints`

```sql
id         UUID PRIMARY KEY DEFAULT gen_random_uuid()
cohort_id  UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE
student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE
type       TEXT CHECK (type IN ('small_class','large_class','max_flagged_peers','max_conflict_peers'))
parameter  INTEGER                -- required for max_* types; ignored for small_class / large_class
is_hard    BOOLEAN NOT NULL DEFAULT false
weight     FLOAT DEFAULT 1.0
created_at TIMESTAMPTZ DEFAULT now()
updated_at TIMESTAMPTZ DEFAULT now()
```

### `solutions`

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
cohort_id       UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE
label           TEXT                    -- e.g. "Balanced sizes"
score           FLOAT                   -- total weighted penalty (lower = better)
hard_violations INTEGER                 -- must always be 0
soft_violations INTEGER
share_token     UUID UNIQUE             -- NULL until teacher clicks Share
share_enabled   BOOLEAN DEFAULT false
solver_metadata JSONB                   -- {wall_time_s, objective_value, status}
created_at      TIMESTAMPTZ DEFAULT now()
updated_at      TIMESTAMPTZ DEFAULT now()
```

### `class_assignments`

```sql
id           UUID PRIMARY KEY DEFAULT gen_random_uuid()
solution_id  UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE
student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE
class_number INTEGER NOT NULL           -- 1-indexed
UNIQUE (solution_id, student_id)        -- one class per student per solution
```

---

## `db.py`

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os

DATABASE_URL = os.environ["DATABASE_URL"]  # postgresql+asyncpg://...

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

---

## `dependencies.py`

```python
from fastapi import Depends, HTTPException, Cookie
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import jwt, JWTError
import os
from .db import get_db
from .models.teacher import Teacher
from .models.cohort import Cohort

SUPABASE_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]

async def current_teacher(
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> Teacher:
    if not access_token:
        raise HTTPException(status_code=401)
    try:
        payload = jwt.decode(access_token, SUPABASE_JWT_SECRET, algorithms=["HS256"])
        teacher_id: str = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401)
    teacher = await db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=401)
    return teacher

async def get_cohort_or_403(
    cohort_id: str,
    teacher: Teacher = Depends(current_teacher),
    db: AsyncSession = Depends(get_db),
) -> Cohort:
    """Use this dependency in every route that touches cohort-scoped data.
    Never trust a cohort_id from the URL alone — always verify ownership."""
    cohort = await db.scalar(
        select(Cohort).where(
            Cohort.id == cohort_id,
            Cohort.teacher_id == teacher.id
        )
    )
    if not cohort:
        raise HTTPException(status_code=403)
    return cohort
```

---

## Security rules (apply everywhere)

| Rule | Detail |
|---|---|
| **IDOR prevention** | Every DB query touching cohort/student/constraint/solution data MUST filter by `teacher_id`. Use `get_cohort_or_403` — never skip it. |
| **JWT storage** | Tokens stored in `httpOnly` cookies only. Never `localStorage`. |
| **Input sanitisation** | Use Pydantic v2 validators on all inputs. See per-router specs for field-level rules. |
| **Share endpoints** | `/share/{token}` is the only public (no-auth) endpoint. Return `404` on revoked tokens — never `403` or `410`. |
| **Rate limiting** | Use `slowapi`. Limits defined per router spec. |

---

## Environment variables

```bash
DATABASE_URL=postgresql+asyncpg://postgres:dev@localhost/kidsplitter
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_JWT_SECRET=your-jwt-secret
FRONTEND_URL=http://localhost:5173
SHARE_BASE_URL=http://localhost:5173
```

---

## Conventions

- All IDs are UUIDs. Accept as `str` in path params; cast to `UUID` inside handler or via Pydantic.
- Return `404` when a resource doesn't exist; `403` when it exists but the teacher doesn't own it.
- Never return `last_name`, teacher email, or sensitive tags (e.g. `behavioural`) on public endpoints.
- Alembic handles all schema changes — never use `Base.metadata.create_all()` in production.
- All DB operations are `async` / `await`.
