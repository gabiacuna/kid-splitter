FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim
# Pinned to the uv version used locally (`uv --version` = 0.12.21). Bump deliberately.
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /uvx /bin/
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY --from=frontend-build /app/frontend/dist /app/static
ENV STATIC_DIR=/app/static
# RUN_MIGRATIONS=true applies `alembic upgrade head` before starting the server (opt-in; default is off).
# alembic/env.py reads DATABASE_URL. Run migrations against the DIRECT connection (port 5432),
# not the transaction pooler (port 6543): DDL and migration locking are unreliable through a pooler.
# A failed migration exits the container non-zero, so the server never starts on a half-migrated schema.
# --forwarded-allow-ips=* is only safe because the container is reachable solely through Cloud Run's
# front end (keep ingress restricted to the load balancer / Cloud Run proxy). Cloud Run's proxy IPs
# are not fixed, so a specific IP list cannot be used. Do not expose this container directly.
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" = \"true\" ]; then uv run alembic upgrade head; fi && exec uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips=*"]
