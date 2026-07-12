# Router Spec — `auth.py`

> **Prereq:** Load `00_shared_context.md` first.  
> **File:** `backend/app/routers/auth.py`  
> **Dependencies used:** `get_db`, `current_teacher`

---

## Responsibility

Registration, login, logout, and profile retrieval for teachers. Passwords are hashed with `bcrypt`. JWTs are issued by Supabase Auth and stored in `httpOnly` cookies.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | None | Create teacher account |
| POST | `/auth/login` | None | Email + password → set JWT cookie |
| POST | `/auth/logout` | Required | Clear JWT cookie |
| GET | `/auth/me` | Required | Return current teacher profile |

---

## SQLAlchemy model — `models/teacher.py`

```python
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, DateTime, func
from ..db import Base
import uuid

class Teacher(Base):
    __tablename__ = "teachers"

    id:            Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email:         Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    school_name:   Mapped[str] = mapped_column(String, nullable=False)
    created_at:    Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:    Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

---

## Pydantic schemas — `schemas/auth.py`

### Request schemas

```python
from pydantic import BaseModel, EmailStr, field_validator
import re

class RegisterRequest(BaseModel):
    email:       EmailStr
    password:    str
    school_name: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("school_name")
    @classmethod
    def school_name_clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("school_name is required")
        if len(v) > 200:
            raise ValueError("school_name too long")
        return v

class LoginRequest(BaseModel):
    email:    EmailStr
    password: str
```

### Response schemas

```python
class TeacherOut(BaseModel):
    id:          str
    email:       str
    school_name: str

    model_config = {"from_attributes": True}

class AuthResponse(BaseModel):
    teacher: TeacherOut
    # access_token is NOT returned in body — it is set as httpOnly cookie only
```

### Field summary

| Schema | Field | Type | Required | Validation |
|---|---|---|---|---|
| RegisterRequest | email | EmailStr | ✅ | Valid email format |
| RegisterRequest | password | str | ✅ | Min 8 chars |
| RegisterRequest | school_name | str | ✅ | Stripped, non-empty, max 200 chars |
| LoginRequest | email | EmailStr | ✅ | Valid email format |
| LoginRequest | password | str | ✅ | No rules (wrong password = 401) |
| TeacherOut | id | str | — | UUID string |
| TeacherOut | email | str | — | — |
| TeacherOut | school_name | str | — | — |

---

## Business logic

### `POST /auth/register`

1. Check `email` is not already in `teachers`. If duplicate → `400 {"detail": "Email already registered"}`.
2. Hash password: `bcrypt.hashpw(password.encode(), bcrypt.gensalt())`.
3. Insert `Teacher` row.
4. Issue JWT via Supabase Auth API (`POST /auth/v1/signup`) using the same email/password, so Supabase manages the token.
5. Set `access_token` and `refresh_token` from Supabase response as `httpOnly`, `SameSite=Lax`, `Secure` (prod) cookies.
6. Return `201` with `TeacherOut`.

### `POST /auth/login`

1. Look up teacher by email. If not found → `401 {"detail": "Invalid credentials"}`.
2. Verify password: `bcrypt.checkpw(...)`. If wrong → `401`. Use constant-time comparison.
3. Call Supabase Auth `POST /auth/v1/token?grant_type=password` to get JWT pair.
4. Set `httpOnly` cookies (`access_token`, `refresh_token`).
5. Return `200` with `TeacherOut`.

> **Do not return different error messages for "user not found" vs "wrong password"** — both must return the same `401 {"detail": "Invalid credentials"}` to prevent user enumeration.

### `POST /auth/logout`

1. Require `current_teacher` dependency (validates JWT).
2. Delete both cookies by setting `max_age=0`.
3. Optionally call Supabase `POST /auth/v1/logout` to invalidate server-side session.
4. Return `200 {"detail": "Logged out"}`.

### `GET /auth/me`

1. Require `current_teacher` dependency.
2. Return `TeacherOut` from the injected `Teacher` object.

---

## Cookie configuration

```python
response.set_cookie(
    key="access_token",
    value=access_token,
    httponly=True,
    samesite="lax",
    secure=True,   # False in local dev only
    max_age=3600,  # 1 hour — matches Supabase default
)
response.set_cookie(
    key="refresh_token",
    value=refresh_token,
    httponly=True,
    samesite="lax",
    secure=True,
    max_age=604800,  # 7 days
)
```

---

## DO NOTs

- **Do not** store tokens in the response body or in `localStorage` — XSS risk.
- **Do not** return `password_hash` in any response schema ever.
- **Do not** use different error messages for unknown email vs wrong password (user enumeration).
- **Do not** issue your own JWTs — always delegate to Supabase Auth so token validation stays consistent across the app.
- **Do not** skip the Supabase `signup` call on register — if you only insert the DB row, `current_teacher` JWT validation will fail because Supabase won't know the user.
