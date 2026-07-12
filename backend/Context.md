# Backend Context — Kid Splitter

Kid Splitter is a class-scheduling tool for primary school teachers. Teachers define a cohort of students and constraints (keep together / keep apart), and the backend runs an OR-Tools CP-SAT solver to produce 2–3 optimised class groupings. A share-link feature lets teachers share read-only rosters without exposing sensitive student data.

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
| Solver | OR-Tools CP-SAT |

---

## Project layout

```
backend/app/
├── main.py               # FastAPI init, CORS, middleware, router registration
├── db.py                 # Async engine + session factory
├── dependencies.py       # Shared FastAPI dependencies
├── models/
│   ├── teacher.py
│   ├── cohort.py
│   ├── student.py
│   ├── constraint.py     # BinaryConstraint + UnaryConstraint
│   └── solution.py       # Solution + ClassAssignment
├── schemas/              # Pydantic v2 request/response schemas
├── routers/
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

## Database schema (summary)

All tables have `created_at` and `updated_at` (`TIMESTAMPTZ`). Row-level isolation is enforced by always filtering on `teacher_id`.

| Table | Key columns |
|---|---|
| `teachers` | `id UUID PK`, `email UNIQUE`, `password_hash`, `school_name` |
| `cohorts` | `id`, `teacher_id FK`, `name`, `year`, `num_classes` (min 2) |
| `students` | `id`, `cohort_id FK`, `first_name`, `last_name`, `tags TEXT[]`, `import_source` |
| `binary_constraints` | `id`, `cohort_id FK`, `student_a_id FK`, `student_b_id FK`, `type` (`together`/`separate`), `is_hard`, `weight` (0.1–10.0) |
| `unary_constraints` | `id`, `cohort_id FK`, `student_id FK`, `type` (`small_class`/`large_class`/`max_flagged_peers`/`max_conflict_peers`), `parameter`, `is_hard`, `weight` |
| `solutions` | `id`, `cohort_id FK`, `label`, `score`, `hard_violations`, `soft_violations`, `share_token UUID UNIQUE`, `share_enabled`, `solver_metadata JSONB` |
| `class_assignments` | `id`, `solution_id FK`, `student_id FK`, `class_number` (1-indexed); UNIQUE `(solution_id, student_id)` |

Full column definitions are in `docs/00_shared_context.md`.

---

## Core dependencies (`dependencies.py`)

```python
async def current_teacher(access_token: str | None = Cookie(...), db=Depends(get_db)) -> Teacher
async def get_cohort_or_403(cohort_id: str, teacher=Depends(current_teacher), db=Depends(get_db)) -> Cohort
```

`get_cohort_or_403` verifies `cohort.teacher_id == teacher.id`. Use it in **every** route that touches cohort-scoped data.

---

## Security rules

| Rule | Detail |
|---|---|
| **IDOR prevention** | Every query on cohort/student/constraint/solution data MUST filter by `teacher_id`. Always use `get_cohort_or_403`. |
| **JWT storage** | `httpOnly` cookies only — never `localStorage`. |
| **Input sanitisation** | Pydantic v2 validators on all inputs. |
| **Share endpoint** | `/share/{token}` is the only public (no-auth) endpoint. Return `404` on revoked/unknown tokens — never `403` or `410`. |
| **Rate limiting** | `slowapi`. Limits per router spec. Solve: 10/hour per teacher. Share public: 60/min per IP. |
| **Error messages** | Auth routes must not distinguish "user not found" vs "wrong password" (user enumeration). |
| **last_name** | Never exposed on public share endpoints. Sensitive tags (`behavioural`, `needs-support`, `iep`, `medical`) also never exposed publicly. |

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

- All IDs are UUIDs. Accept as `str` in path params; validate via Pydantic.
- Return `404` when a resource doesn't exist; `403` when it exists but is not owned by the requesting teacher.
- All DB operations are `async`/`await`.
- Alembic handles all schema changes — never use `Base.metadata.create_all()` in production.
- Solver runs in a `ThreadPoolExecutor` — never block the async event loop.
- CP-SAT requires integer weights — scale all floats by `WEIGHT_SCALE = 100`.
- A persisted solution must always have `hard_violations = 0`. Log an error and do not persist if this invariant is broken.

---

## Router specs

Detailed specs live in `docs/`:

| File | Covers |
|---|---|
| `docs/00_shared_context.md` | Stack, models, dependencies, security — load before any router spec |
| `docs/01_auth.md` | `/auth/*` — register, login, logout, me |
| `docs/02_cohorts.md` | `/cohorts/*` — CRUD |
| `docs/03_students.md` | `/cohorts/{id}/students` — CRUD + CSV import |
| `docs/04_constraints.md` | `/cohorts/{id}/constraints` — binary + unary |
| `docs/05_solver.md` | `/cohorts/{id}/solve`, `/solutions/*` — solver + solution management |
| `docs/06_share.md` | `/solutions/{id}/share`, `/share/{token}` — share links |
