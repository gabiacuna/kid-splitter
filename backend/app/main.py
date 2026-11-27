import os
from pathlib import Path
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .limiter import limiter
from .routers import account, auth, cohorts, students, constraints, solve, share

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")


def _resolve_static_dir() -> Path | None:
    env_dir = os.environ.get("STATIC_DIR")
    if env_dir:
        candidate = Path(env_dir)
        return candidate if candidate.is_dir() and (candidate / "index.html").is_file() else None
    root = Path(__file__).resolve().parents[2]
    for candidate in (root / "static", root / "frontend" / "dist"):
        if candidate.is_dir() and (candidate / "index.html").is_file():
            return candidate
    return None


app = FastAPI(title="Kid Splitter API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(account.router)
api_router.include_router(cohorts.router)
api_router.include_router(students.router)
api_router.include_router(constraints.router)
api_router.include_router(solve.router)
api_router.include_router(share.router)


@api_router.get("/health")
async def health():
    return {"status": "ok"}


@api_router.get("/health/ready")
async def health_ready(db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT 1"))
    return {"status": "ok"}


app.include_router(api_router)

STATIC_DIR = _resolve_static_dir()
if STATIC_DIR is not None:
    static_root = STATIC_DIR.resolve()
    if (static_root / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=static_root / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        if full_path:
            candidate = (static_root / full_path).resolve()
            if candidate.is_file() and static_root in candidate.parents:
                return FileResponse(candidate)
        return FileResponse(static_root / "index.html")
