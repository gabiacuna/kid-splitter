# Backend Implementation Status

## Summary

All 6 router domains are scaffolded and all endpoints exist. The core happy path works end-to-end. No known functional gaps remain.

---

## 01 · Auth (`routers/auth.py`)

| Endpoint | Status | Notes |
|---|---|---|
| POST /auth/register | ✅ Done | bcrypt hash, Supabase signup, httpOnly cookies |
| POST /auth/login | ✅ Done | constant-time password check, Supabase token |
| POST /auth/refresh | ✅ Done | exchanges refresh token with Supabase and rotates both cookies |
| POST /auth/logout | ✅ Done | clears both cookies |
| GET /auth/me | ✅ Done | |

**Missing / gaps:**
- Logout does not call `POST /auth/v1/logout` on Supabase to invalidate the server-side session (listed as optional in spec, low priority).

---

## 02 · Cohorts (`routers/cohorts.py`)

| Endpoint | Status | Notes |
|---|---|---|
| GET /cohorts | ✅ Done | SQL COUNT join, ordered by created_at desc |
| POST /cohorts | ✅ Done | |
| GET /cohorts/{id} | ✅ Done | |
| PUT /cohorts/{id} | ✅ Done | partial update + num_classes warning |
| DELETE /cohorts/{id} | ✅ Done | cascade via ORM |

**Missing / gaps:** None.

---

## 03 · Students (`routers/students.py`, `services/csv_import.py`)

| Endpoint | Status | Notes |
|---|---|---|
| GET /cohorts/{id}/students | ✅ Done | ordered by last_name, first_name |
| POST /cohorts/{id}/students | ✅ Done | import_source = 'manual' |
| POST /cohorts/{id}/students/import | ✅ Done | preview only, not committed |
| POST /cohorts/{id}/students/import/confirm | ✅ Done | re-validates via Pydantic on deserialization |
| PUT /students/{id} | ✅ Done | partial update, ownership via join |
| DELETE /students/{id} | ✅ Done | cascade removes constraints |

**Missing / gaps:** None.

---

## 04 · Constraints (`routers/constraints.py`, `services/validator.py`)

| Endpoint | Status | Notes |
|---|---|---|
| GET /cohorts/{id}/constraints | ✅ Done | returns both binary + unary |
| POST /cohorts/{id}/constraints/binary | ✅ Done | student cohort membership verified |
| POST /cohorts/{id}/constraints/unary | ✅ Done | |
| PUT /constraints/binary/{id} | ✅ Done | weight preserved when is_hard=true |
| PUT /constraints/unary/{id} | ✅ Done | |
| DELETE /constraints/binary/{id} | ✅ Done | |
| DELETE /constraints/unary/{id} | ✅ Done | |
| GET /cohorts/{id}/constraints/validate | ✅ Done | |

**Validator checks:**

| Check | Status |
|---|---|
| Direct conflict (hard together + hard separate on same pair) | ✅ Done |
| Cluster overflow (BFS on together graph) | ✅ Done |
| Coloring impossible (greedy graph coloring on separate graph) | ✅ Done |
| Soft warning (A+B together, B+C together, A+C separate) | ✅ Done |

**Missing / gaps:** None.

---

## 05 · Solver (`routers/solve.py`, `services/solver.py`)

| Endpoint | Status | Notes |
|---|---|---|
| POST /cohorts/{id}/solve | ✅ Done | pre-checks, thread pool, 3 variants persisted |
| GET /cohorts/{id}/solutions | ✅ Done | |
| GET /solutions/{id} | ✅ Done | includes full assignments |
| DELETE /solutions/{id} | ✅ Done | |

**Solver variants:**

| Variant | Status |
|---|---|
| `balanced_sizes` (minimize size variance) | ✅ Done |
| `soft_priority` (full weighted soft constraints) | ✅ Done |
| `diversity_mix` (soft + tag diversity penalty) | ✅ Done |

**Constraint encoding:**

| Encoding | Status |
|---|---|
| Hard together / hard separate | ✅ Done |
| Soft together / soft separate (correct `both_in_k` pattern) | ✅ Done |
| `small_class` unary (soft + hard) | ✅ Done |
| `large_class` unary (soft + hard) | ✅ Done |
| `max_flagged_peers` / `max_conflict_peers` | ✅ Done |

**Missing / gaps:** None.

---

## 06 · Share (`routers/share.py`)

| Endpoint | Status | Notes |
|---|---|---|
| POST /solutions/{id}/share | ✅ Done | idempotent — returns existing token if already enabled |
| DELETE /solutions/{id}/share | ✅ Done | sets both share_token=NULL and share_enabled=False |
| GET /share/{token} | ✅ Done | public, no auth, 60 req/min rate limit |

**Security rules:**

| Rule | Status |
|---|---|
| Revoked token returns 404 (not 403/410) | ✅ Done |
| `last_name` never returned | ✅ Done |
| Tag allowlist (not denylist) | ✅ Done — `WHITELISTED_TAGS = {"esl", "gifted", "new-student"}` |
| Teacher email / school name not exposed | ✅ Done |
| Rate limit 60/min per IP | ✅ Done |

**Missing / gaps:** None.

---

## Changelog

### 2026-11-23 — conflict groups (design feature 04)
1. **`GET /cohorts/{id}/constraints/validate` returns `conflict_groups`** — each group has the exact constraint ids involved (badge number = group id), severity, and a plain-language explanation using student names. `contradictions` is kept (deprecated) for one release.
2. **`coloring_impossible` is exact** (CP-SAT, 2s limit, permissive on timeout). Greedy colouring could reject solvable cohorts with a false 422.
3. **New `chain_conflict` check** — must-be-apart students linked by a chain of must-be-together rules (previously undetected until the solver failed).
4. **Binary/unary `PUT` accept student ids** — changing a rule's students previously no-op'd silently.

### 2026-11-23 — gender (design features 01–03)
1. **`students.gender`** (`'boy' | 'girl' | NULL`, CHECK-constrained). `PUT /students/{id}` uses `model_fields_set`, so an explicit `"gender": null` clears it. CSV import reads an optional `gender` column (b/boy/m/male, g/girl/f/female); unrecognised values import as unknown with status `invalid_gender`.
2. **`cohorts.balance_gender`** (bool, default false) on create/update/out.
3. **Solver gender balance** for `soft_priority` and `diversity_mix` when the flag is on: squared per-class deviation for each known gender, applied as a strict lexicographic tiebreaker (`(bound+1) × preference_penalty + gender_penalty`) so it can never cost a preference. `score`/`objective_value` report the preference penalty only. Unknown-gender students float.
4. **`gender_split`** (`boys`/`girls`/`unknown` per class) on every `SolutionOut`, computed on read (not persisted); list endpoint uses two queries regardless of solution count.

### 2026-11-23
1. **`num_classes` capped at 2–4** — `CohortCreate`, `CohortUpdate` and `SolveRequest` reject values outside 2–4 (was 2–20). See `docs/design-implementation/10-class-count-cap.md`.
2. **Migrations folded** — `002_add_unary_constraint_tag` merged into `001_initial_schema`; `002` deleted. Existing dev databases must be recreated (`dropdb kidsplitter && createdb kidsplitter && uv run alembic upgrade head`).

### 2026-07-02
1. **Supabase JWT verification migrated to JWKS** — access tokens are verified as ES256 against the project's JWKS endpoint; the legacy `SUPABASE_JWT_SECRET` is no longer used.
2. **Auth refresh endpoint added** — `POST /auth/refresh` exchanges the refresh cookie with Supabase and rotates both auth cookies.

### 2026-06-30
1. **`max_flagged_peers` / `max_conflict_peers` fixed** — added `tag` column to `unary_constraints` (migration `002`), updated model/schema/router/solver to store and use the actual tag name instead of `c.type`.
2. **`soft_violations` computed correctly** — added `_count_soft_violations()` in `solver.py`; `SolverResult.soft_violations` is now the real violated-constraint count, stored on persist.
3. **Solve rate limit keyed on teacher ID** — `current_teacher` dependency now sets `request.state.teacher_id` before the `@limiter.limit` decorator fires.
4. **CSV tag format validated in preview** — `_parse_tags()` rejects tags not matching `^[a-zA-Z0-9_-]+$`; invalid tags surface as `invalid_tag` rows in preview rather than failing silently on confirm.
