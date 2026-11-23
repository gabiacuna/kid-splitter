# Deployment: GCP Cloud Run + Supabase ($0/month after credits)

**Scope:** backend + frontend + infra · **Status:** implemented

## Goal & Constraints

Deploy Kid Splitter to production using existing GCP credits now, while guaranteeing **$0/month recurring cost once GCP credits expire**.

- **Why not Cloud SQL?** Cloud SQL has no Always Free tier (~$10–$15/month minimum 24/7).
- **Why not an `e2-micro` Always-Free VM with local Postgres?** `e2-micro` only has 1 GB RAM total; running the OS + Postgres + Python + Google OR-Tools CP-SAT solver in 1 GB risks OOM kills during multi-variant solves.
- **Chosen architecture:**
  1. **GCP Cloud Run** (single container serving both the built React SPA and FastAPI + OR-Tools, `min-instances=0`, in an Always-Free Tier region such as `us-central1` or `us-east1`).
  2. **Supabase Free Tier** (managed PostgreSQL + Supabase Auth, $0/month).
  3. **GCP Cloud Scheduler** (1 free cron job pinging `/api/health` every 3 days so the Supabase free project never auto-pauses after 7 days of inactivity).

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
- Update `/health` → `/api/health` and have it execute `SELECT 1` against Postgres (`await db.execute(text("SELECT 1"))`) so Cloud Scheduler's ping generates real database activity in Supabase.
- When `frontend/dist` exists on disk (inside the production Docker image):
  - Mount `/assets` via `StaticFiles(directory=".../dist/assets")`.
  - Add a catch-all `GET /{full_path:path}` route (registered *after* `/api` routers) that serves static files from `dist/` if they exist (e.g. `logo.svg`, `favicon.ico`) and otherwise falls back to `dist/index.html` for React Router SPA navigation.

### 2. Frontend API base URL (`frontend/src/lib/api.ts` & `frontend/vite.config.ts`)

- In `frontend/src/lib/api.ts`, change:
  ```ts
  baseURL: import.meta.env.VITE_API_URL || '/api',
  ```
- In `frontend/vite.config.ts`, add a dev server proxy for `/api` → `http://localhost:8000` (or set `VITE_API_URL=http://localhost:8000/api` in local dev / Playwright E2E).
- Update any hardcoded `http://localhost:8000/...` calls in `frontend/e2e/` to include `/api`.

### 3. Supabase Pooler compatibility (`backend/app/db.py`)

- Cloud Run scales containers dynamically, so production `DATABASE_URL` should use Supabase's **Supavisor Transaction Pooler** (port `6543`) with `?pgbouncer=true` or `connect_args={"statement_cache_size": 0}` on `create_async_engine` (since `asyncpg` prepared statements must be disabled in transaction-pooling mode).
- Use the Direct / Session Pooler connection (port `5432`) only when running `alembic upgrade head`.

### 4. Multi-stage `Dockerfile` (repo root) & `.dockerignore`

- **Stage 1 (`node:22-alpine`)**:
  - Copy `frontend/package.json` and `frontend/package-lock.json`, run `npm ci`.
  - Copy `frontend/` and run `npm run build` → outputs `/app/frontend/dist`.
- **Stage 2 (`python:3.14-slim`)**:
  - Install `uv` (from `ghcr.io/astral-sh/uv:latest`).
  - Copy `backend/pyproject.toml` and `backend/uv.lock`, run `uv sync --frozen --no-dev`.
  - Copy `backend/app`, `backend/alembic`, `backend/alembic.ini`, and `--from=frontend-build /app/frontend/dist ./static`.
  - Run `uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips="*"` (`--proxy-headers` ensures `slowapi` rate-limiting sees the real client IP behind Cloud Run's load balancer).

---

## GCP & Supabase Deployment Checklist

### 1. Supabase Configuration
- Apply migrations against Supabase Postgres:
  ```bash
  DATABASE_URL="postgresql+asyncpg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
    uv run alembic upgrade head
  ```
- In **Supabase Dashboard → Authentication → URL Configuration**:
  - Set **Site URL** to the Cloud Run service URL (`https://kid-splitter-<hash>-uc.a.run.app`).

### 2. Cloud Run Service Settings (Always-Free Tier eligible)
- **Region**: `us-central1` (Iowa) or `us-east1` (South Carolina) — Tier 1 regions required for the Cloud Run Always Free quota.
- **Scaling**: `min-instances = 0`, `max-instances = 3` (caps spend and protects DB connections).
- **Resources**: `1` or `2` vCPU, `1 GiB` memory, CPU allocated only during request processing (`--cpu-throttling`).
- **Environment variables / Secret Manager**:
  - `ENV=production` (enables `Secure` flag on auth cookies)
  - `SUPABASE_URL=https://<project-ref>.supabase.co`
  - `SUPABASE_ANON_KEY=<publishable-anon-key>`
  - `SUPABASE_SECRET_KEY=<service-role-or-secret-key>` (stored in GCP Secret Manager)
  - `DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres` (stored in GCP Secret Manager)
  - `FRONTEND_URL=https://kid-splitter-<hash>-uc.a.run.app`
  - `SHARE_BASE_URL=https://kid-splitter-<hash>-uc.a.run.app`

### 3. Cloud Scheduler Keep-Alive (Prevents Supabase 7-day pause)
- Create a single Cloud Scheduler HTTP job (Always Free tier includes 3 jobs/month):
  - **Schedule**: `0 9 */3 * *` (every 3 days at 09:00 UTC)
  - **Target**: `GET https://kid-splitter-<hash>-uc.a.run.app/api/health`
- Verification: `GET /api/health` runs `SELECT 1` on Supabase Postgres and returns `{"status": "ok"}`.
