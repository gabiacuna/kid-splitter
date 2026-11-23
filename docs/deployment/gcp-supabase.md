# Deployment: GCP Cloud Run + Supabase ($0/month after credits)

**Scope:** backend + frontend + infra · **Status:** implemented

## Goal & Constraints

Deploy Kid Splitter to production using existing GCP credits now, while guaranteeing **$0/month recurring cost once GCP credits expire**.

- **Why not Cloud SQL?** Cloud SQL has no Always Free tier (~$10–$15/month minimum 24/7).
- **Why not an `e2-micro` Always-Free VM with local Postgres?** `e2-micro` only has 1 GB RAM total; running the OS + Postgres + Python + Google OR-Tools CP-SAT solver in 1 GB risks OOM kills during multi-variant solves.
- **Chosen architecture:**
  1. **GCP Cloud Run** (single container serving both the built React SPA and FastAPI + OR-Tools, `min-instances=0`, in an Always-Free Tier region such as `us-central1` or `us-east1`).
  2. **Supabase Free Tier** (managed PostgreSQL + Supabase Auth, $0/month).
  3. **GCP Cloud Scheduler** (1 free cron job pinging `/api/health/ready` every 3 days so the Supabase free project never auto-pauses after 7 days of inactivity).

---

## Architecture Overview

```text
Browser
  │
  ├── GET /cohorts, /share/:token, /assets/* ──► FastAPI SPA static handler (frontend/dist)
  │
  └── /api/auth/*, /api/cohorts/*, ...       ──► FastAPI API routers (httpOnly SameSite=Lax cookies)
                                                    │
                                                    ├── asyncpg (Transaction Pooler :6543) ──► Supabase Postgres
                                                    └── httpx (/auth/v1/*)                 ──► Supabase Auth
```

### Why single-container same-origin (`/api` prefix)?

1. **Cookies work natively:** Auth uses `httpOnly` cookies (`access_token`, `refresh_token`) with `SameSite=Lax` and `Secure=True` (`ENV=production`). Serving the SPA and API from the same Cloud Run origin avoids third-party cookie blocking (`SameSite=None`), CORS preflights, and needing a custom domain on day one.
2. **Avoids route collisions:** Both React Router and FastAPI define `/cohorts`, `/cohorts/:id`, `/solutions/:id`, and `/share/:token`. If FastAPI mounted API routes at `/`, refreshing `/cohorts` or opening a `/share/:token` link in a browser would hit the FastAPI JSON endpoint instead of returning `index.html`. Mounting all API routes under `/api` eliminates every collision.

---

## Required Code Changes

### 1. Prefix API routes with `/api` (`backend/app/main.py`)

- Mount all existing routers (`auth`, `account`, `cohorts`, `students`, `constraints`, `solve`, `share`) under an `/api` parent router (or `prefix="/api"`).
- Health endpoints:
  - `GET /api/health` is a **cheap liveness check with no DB access**. Use it for Cloud Run startup and liveness probes.
  - `GET /api/health/ready` runs `SELECT 1` against Postgres (`await db.execute(text("SELECT 1"))`) and is the readiness check. Cloud Scheduler's keep-alive ping uses it so Supabase sees real database activity.
- When `frontend/dist` exists on disk (inside the production Docker image):
  - Mount `/assets` via `StaticFiles(directory=".../dist/assets")`.
  - Add a catch-all `GET /{full_path:path}` route (registered *after* `/api` routers) that serves static files from `dist/` if they exist (e.g. `logo.svg`, `favicon.ico`) and otherwise falls back to `dist/index.html` for React Router SPA navigation.

### 2. Frontend API base URL (`frontend/src/lib/api.ts` & `frontend/vite.config.ts`)

- Done: `frontend/src/lib/api.ts` uses `baseURL: import.meta.env.VITE_API_URL || '/api'`.
- Done: `frontend/vite.config.ts` proxies `/api` to `http://localhost:8000` in dev.
- Done: `frontend/e2e/` URLs include `/api`.

### 3. Supabase Pooler compatibility (`backend/app/db.py`)

- Cloud Run scales containers dynamically, so production `DATABASE_URL` should use Supabase's **Supavisor Transaction Pooler** (port `6543`) with `?pgbouncer=true` or `connect_args={"statement_cache_size": 0}` on `create_async_engine` (since `asyncpg` prepared statements must be disabled in transaction-pooling mode).
- Run migrations over the **direct connection (port `5432`)**, never the transaction pooler. See `RUN_MIGRATIONS` below.

### 4. Multi-stage `Dockerfile` (repo root) & `.dockerignore`

- **Stage 1 (`node:22-alpine`)**:
  - Copy `frontend/package.json` and `frontend/package-lock.json`, run `npm ci`.
  - Copy `frontend/` and run `npm run build` → outputs `/app/frontend/dist`.
- **Stage 2 (`python:3.14-slim`)**:
  - Install `uv` pinned to `ghcr.io/astral-sh/uv:0.12.21` (the version reported by `uv --version`; bump deliberately).
  - Copy `backend/pyproject.toml` and `backend/uv.lock`, run `uv sync --frozen --no-dev`.
  - Copy `backend/app`, `backend/alembic`, `backend/alembic.ini`, and `--from=frontend-build /app/frontend/dist ./static`.
  - Start command (`CMD`): optionally run `uv run alembic upgrade head` when `RUN_MIGRATIONS=true`, then `exec uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips=*`.
    - `--proxy-headers` ensures `slowapi` rate-limiting sees the real client IP behind Cloud Run's load balancer.
    - `--forwarded-allow-ips=*` is safe only because the container is reachable solely through Cloud Run's front end. Keep ingress restricted; do not expose the container directly.

### Running migrations (`RUN_MIGRATIONS`)

Migrations are **opt-in** and off by default. `backend/alembic/env.py` reads `DATABASE_URL`.

- `RUN_MIGRATIONS=true` makes the container run `alembic upgrade head` before uvicorn starts. If the migration fails, the container exits non-zero and the server does not start.
- Set `DATABASE_URL` to the **direct / session connection on port `5432`** when `RUN_MIGRATIONS=true`, not the transaction pooler on `6543`.
- Leave `RUN_MIGRATIONS` unset in normal operation. Running migrations on every instance start is redundant once the schema is current. Running them from a laptop (see checklist below) is an equally valid alternative.

---

## Repository Notes

- `.claude/`, `.agents/` and `skills-lock.json` are **intentionally gitignored**. They hold local agent skills and configuration, so clones and CI builds do not include them.

---

## GCP & Supabase Deployment Checklist

### 1. Supabase Configuration
- Apply migrations against Supabase Postgres (direct connection, port `5432`):
  ```bash
  DATABASE_URL="postgresql+asyncpg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
    uv run alembic upgrade head
  ```
  Alternatively, deploy with `RUN_MIGRATIONS=true` and the port-5432 `DATABASE_URL` for that run.
- In **Supabase Dashboard → Authentication → URL Configuration**:
  - Set **Site URL** to the Cloud Run service URL (`https://kid-splitter-<hash>-uc.a.run.app`).

### 2. Cloud Run Service Settings (Always-Free Tier eligible)
- **Region**: `us-central1` (Iowa) or `us-east1` (South Carolina) — Tier 1 regions required for the Cloud Run Always Free quota.
- **Ingress**: restricted (not "all traffic" if avoidable). The app trusts `X-Forwarded-For` from any source (see `--forwarded-allow-ips=*` in the `Dockerfile`).
- **Scaling**: `min-instances = 0`, `max-instances = 3` (caps spend and protects DB connections).
- **Resources**: `1` or `2` vCPU, `1 GiB` memory, CPU allocated only during request processing (`--cpu-throttling`).
- **Health probes**: use `/api/health` for startup and liveness probes. It does not touch the database, so a Supabase hiccup does not restart the container.
- **Environment variables / Secret Manager**:
  - `ENV=production` (enables `Secure` flag on auth cookies)
  - `SUPABASE_URL=https://<project-ref>.supabase.co`
  - `SUPABASE_ANON_KEY=<publishable-anon-key>`
  - `SUPABASE_SECRET_KEY=<service-role-or-secret-key>` (stored in GCP Secret Manager)
  - `DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres` (stored in GCP Secret Manager; use port `5432` when `RUN_MIGRATIONS=true`)
  - `RUN_MIGRATIONS=false` (optional; set to `true` only for a deploy that should apply migrations at startup)
  - `FRONTEND_URL=https://kid-splitter-<hash>-uc.a.run.app`
  - `SHARE_BASE_URL=https://kid-splitter-<hash>-uc.a.run.app`

### 3. Cloud Scheduler Keep-Alive (Prevents Supabase 7-day pause)
- Create a single Cloud Scheduler HTTP job (Always Free tier includes 3 jobs/month):
  - **Schedule**: `0 9 */3 * *` (every 3 days at 09:00 UTC)
  - **Target**: `GET https://kid-splitter-<hash>-uc.a.run.app/api/health/ready`
- Verification: `GET /api/health/ready` runs `SELECT 1` on Supabase Postgres and returns `{"status": "ok"}`. `GET /api/health` returns `{"status": "ok"}` without touching the database.
