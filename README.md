# Kid Splitter

Web tool for teachers to split student cohorts into balanced classes (2–4 classes) while honoring together/apart rules, gender balance, and student tags using Google OR-Tools (CP-SAT).

## Stack

- **Frontend:** React 19, TypeScript, Vite, TanStack Query (`frontend/`)
- **Backend:** FastAPI, SQLAlchemy (`asyncpg`), Alembic, OR-Tools, OpenPyXL (`backend/`)
- **Auth & DB:** Supabase Auth + PostgreSQL

## Local Development

### 1. Backend (`http://localhost:8000`)

Requires Python 3.14+, PostgreSQL 15+, and [`uv`](https://github.com/astral-sh/uv).

```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

### 2. Frontend (`http://localhost:5173`)

Requires Node 22+.

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api/*` requests to `http://localhost:8000`.

## Tests

```bash
# Backend unit tests
cd backend
uv run pytest        # all of tests/ (pytest is a dev dependency)

# Frontend E2E suite (Playwright) — see frontend/e2e/README.md
cd frontend
npx playwright test
```

## Documentation

- **Feature specs:** [`docs/design-implementation/`](docs/design-implementation/00-overview.md)
- **Production deployment (GCP Cloud Run + Supabase):** [`docs/deployment/gcp-supabase.md`](docs/deployment/gcp-supabase.md)
