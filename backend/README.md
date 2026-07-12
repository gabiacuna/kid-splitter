# Kid Splitter — Backend

FastAPI backend for class-scheduling. Teachers define student cohorts and constraints; OR-Tools CP-SAT produces optimised class groupings.

## Quick start

**Prerequisites:** Python 3.11+, PostgreSQL 15, [uv](https://github.com/astral-sh/uv)

```bash
# 1. Install dependencies
cd backend
uv sync

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and SUPABASE_JWT_SECRET at minimum

# 3. Create the database and run migrations
createdb classscheduler
uv run alembic upgrade head

# 4. Start the dev server
uv run uvicorn app.main:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs`.

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://user:pass@host/dbname` |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_JWT_SECRET` | JWT secret from Supabase project settings |
| `FRONTEND_URL` | Origin allowed by CORS (default `http://localhost:5173`) |
| `SHARE_BASE_URL` | Base URL used in share links |

## Running migrations

```bash
# Apply all pending migrations
uv run alembic upgrade head

# Create a new migration after model changes
uv run alembic revision -m "describe change"
```

## Project layout

```
app/
├── main.py            # FastAPI app, CORS, router registration
├── db.py              # Async engine + session factory
├── dependencies.py    # current_teacher, get_cohort_or_403
├── models/            # SQLAlchemy ORM models
├── schemas/           # Pydantic v2 request/response schemas
├── routers/           # auth, cohorts, students, constraints, solve, share
└── services/
    ├── solver.py      # OR-Tools CP-SAT solver (3 variants)
    ├── csv_import.py  # CSV preview parser
    └── validator.py   # Constraint contradiction detection
```

See `docs/` for per-router specs and `status.md` for implementation status.
