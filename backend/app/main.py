import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from .routers import auth, cohorts, students, constraints, solve, share

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Kid Splitter API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(cohorts.router)
app.include_router(students.router)
app.include_router(constraints.router)
app.include_router(solve.router)
app.include_router(share.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
