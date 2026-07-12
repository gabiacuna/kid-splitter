# Router Spec — `share.py`

> **Prereq:** Load `00_shared_context.md` first.  
> **File:** `backend/app/routers/share.py`  
> **Dependencies used:** `get_db`, `current_teacher` (on token management endpoints only)  
> **Rate limit:** 60 requests/min per IP on `GET /share/{token}` (via `slowapi`)

---

## Responsibility

Generate and revoke share tokens for solutions, and serve a public read-only view of a solution via token. This is the only part of the API that is accessible without authentication.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/solutions/{id}/share` | Required | Generate a share token for a solution |
| DELETE | `/solutions/{id}/share` | Required | Revoke the share token |
| GET | `/share/{token}` | **None** | Public read-only solution view |

---

## No additional SQLAlchemy models needed

This router operates on `Solution` and `ClassAssignment` (defined in `models/solution.py`) and `Student` (defined in `models/student.py`). No new tables.

---

## Pydantic schemas — `schemas/share.py`

### Response schemas

```python
from pydantic import BaseModel
from typing import Optional

class ShareTokenOut(BaseModel):
    solution_id:  str
    share_token:  str
    share_url:    str   # full URL: {SHARE_BASE_URL}/share/{token}
    share_enabled: bool

class PublicAssignmentOut(BaseModel):
    first_name:   str        # only first_name — never last_name
    class_number: int
    tags:         list[str]  # whitelisted tags only — see filtering rules below

class PublicSolutionOut(BaseModel):
    solution_id:   str
    cohort_name:   str       # safe to include — doesn't reveal teacher identity
    label:         str
    score:         float
    soft_violations: int
    classes:       dict[int, list[PublicAssignmentOut]]  # {class_number: [students]}
```

### Field summary

| Schema | Field | Type | Notes |
|---|---|---|---|
| ShareTokenOut | share_url | str | Constructed server-side from `SHARE_BASE_URL` env var |
| PublicAssignmentOut | first_name | str | Only first name — last_name is never included |
| PublicAssignmentOut | tags | list[str] | Filtered to whitelisted tags only |
| PublicSolutionOut | classes | dict | Keyed by class_number (int), value is list of students |

---

## Business logic

### `POST /solutions/{id}/share`

1. Require `current_teacher`.
2. Look up `Solution` by `id`. Verify ownership: `solution.cohort.teacher_id == current_teacher.id`. If not owned → `403`.
3. If `share_token` is already set and `share_enabled = true`, return the existing token (idempotent).
4. Generate a new UUID v4 token: `str(uuid.uuid4())`.
5. Set `share_token = token`, `share_enabled = true` on the solution.
6. Commit.
7. Build `share_url = f"{SHARE_BASE_URL}/share/{token}"`.
8. Return `201` with `ShareTokenOut`.

### `DELETE /solutions/{id}/share`

1. Require `current_teacher`. Verify ownership.
2. Set `share_token = None`, `share_enabled = False`.
3. Commit.
4. Return `204 No Content`.

> **On revocation:** if someone holds an old share URL and hits it after revocation, `GET /share/{token}` must return `404` — not `403`, not `410`. Never reveal that the token existed.

### `GET /share/{token}`

**No auth required.**

1. Look up `Solution` where `share_token = token` AND `share_enabled = true`.
2. If not found (token doesn't exist OR `share_enabled = false` OR revoked) → return `404`. Do not distinguish between these cases.
3. Load all `ClassAssignment` rows for this solution, joined with `Student`.
4. Filter and sanitise the student data (see below).
5. Group assignments by `class_number`.
6. Return `200` with `PublicSolutionOut`.

---

## Data filtering on public endpoint

This is a security-critical step. Apply in order:

```python
# Tags that are safe to expose publicly
WHITELISTED_TAGS = {"esl", "gifted", "new-student"}
# Tags that are NEVER exposed (examples — make this configurable per teacher in Phase 5)
SENSITIVE_TAGS   = {"behavioural", "needs-support", "iep", "medical"}

def build_public_assignment(student: Student, class_number: int) -> PublicAssignmentOut:
    safe_tags = [t for t in student.tags if t in WHITELISTED_TAGS]
    return PublicAssignmentOut(
        first_name=student.first_name,
        class_number=class_number,
        tags=safe_tags,
    )
```

| Field | Exposed? | Reason |
|---|---|---|
| `first_name` | ✅ Yes | Needed for roster identification |
| `last_name` | ❌ Never | Privacy — student surnames not shared |
| `tags` (whitelisted) | ✅ Filtered | Safe public labels only |
| `tags` (sensitive) | ❌ Never | Behavioural/medical info is private |
| `cohort_name` | ✅ Yes | Useful context; doesn't identify teacher |
| Teacher email / name | ❌ Never | Not needed on public view |
| `score` / `soft_violations` | ✅ Yes | Useful for transparency |
| `hard_violations` | ❌ No | Internal solver detail; not useful to recipients |

---

## Rate limiting

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.get("/share/{token}")
@limiter.limit("60/minute")
async def get_shared_solution(token: str, ...):
    ...
```

Apply this limit only to `GET /share/{token}`. The token management endpoints (`POST`/`DELETE`) are auth-protected and covered by general API rate limiting.

---

## Security checklist

| Requirement | Implementation |
|---|---|
| Token format | UUID v4 — 122 bits of entropy, not guessable or enumerable |
| Token storage | `solutions.share_token`, unique index in DB |
| Revocation | `share_token = NULL`, `share_enabled = false` — both must be set |
| Revoked token response | Always `404` — never `403`, `410`, or any message hinting the token existed |
| Last name exposure | Never returned from this router under any condition |
| Sensitive tag exposure | Filter against `WHITELISTED_TAGS` — anything not explicitly whitelisted is hidden |
| Rate limiting | 60 req/min per IP on the public endpoint — block enumeration attempts |

---

## DO NOTs

- **Do not** return `403` or `410` on a revoked or unknown token — always `404`.
- **Do not** return `last_name` anywhere in this router — not even in error messages.
- **Do not** expose sensitive tags (`behavioural`, `needs-support`, etc.) — use an allowlist, not a denylist, so new tags are hidden by default.
- **Do not** include teacher email, school name, or any teacher-identifying info in `PublicSolutionOut`.
- **Do not** allow the share endpoint to be used to probe which solution IDs exist — token lookup must be by token value, not by solution ID + token combo.
- **Do not** skip the rate limit on `GET /share/{token}` — UUID v4 is large but rate limiting is still required defence-in-depth.
- **Do not** make tag filtering a denylist — use an allowlist (`WHITELISTED_TAGS`) so that any new tag a teacher creates is hidden by default unless explicitly added to the whitelist.
