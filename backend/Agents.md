# Agents.md — Kid Splitter Backend

Guidelines for AI agents working on this backend. Read `Context.md` first for project overview, stack, and security rules. For any router, also load the relevant spec from `docs/`.

---

## Package manager

This project uses **[uv](https://github.com/astral-sh/uv)** exclusively.

| Task | Command |
|---|---|
| Install a dependency | `uv add <package>` |
| Run a script / module | `uv run python3 ...` |
| Run a CLI tool | `uv run <tool> ...` (e.g. `uv run alembic upgrade head`) |

Never use `pip install`, `pip`, or bare `python` — always `uv add` / `uv run`.

---

## Build order

Follow this sequence — each layer depends on the one above it.

1. `db.py` + `models/` (all ORM models)
2. Alembic migration (`alembic init`, initial `create_all` migration)
3. `dependencies.py` (`get_db`, `current_teacher`, `get_cohort_or_403`)
4. `main.py` (FastAPI init, CORS, router registration)
5. `routers/auth.py` + `schemas/auth.py`
6. `routers/cohorts.py` + `schemas/cohorts.py`
7. `routers/students.py` + `schemas/students.py` + `services/csv_import.py`
8. `routers/constraints.py` + `schemas/constraints.py` + `services/validator.py`
9. `services/solver.py` (CP-SAT model + three-variant runner)
10. `routers/solve.py` + `schemas/solve.py`
11. `routers/share.py` + `schemas/share.py`

---

## Key invariants — never violate these

- **IDOR**: every query on cohort/student/constraint/solution data must filter by `teacher_id`. Use `get_cohort_or_403` — never query by ID alone.
- **Solver hard violations**: a solution with `hard_violations > 0` must not be persisted. Log and skip.
- **Solver event loop**: run the solver via `loop.run_in_executor()` — never call it directly in an async handler.
- **CP-SAT integer weights**: multiply all float weights by `WEIGHT_SCALE = 100` before adding to the objective. CP-SAT rejects floats silently.
- **Soft-together encoding**: do not use the broken `AddBoolOr` pattern. Use per-class `both_in_k` booleans bound to a `same_class` indicator. See `docs/05_solver.md` for the correct encoding.
- **Fresh models per variant**: each of the three solver variants (`balanced_sizes`, `soft_priority`, `diversity_mix`) needs its own `cp_model.CpModel()` instance and a fresh `penalty_terms` list.
- **httpOnly cookies**: JWT tokens go in `httpOnly` cookies only — never in the response body or `localStorage`.
- **Share token 404**: revoked or unknown share tokens always return `404` — never `403`, `410`, or any message indicating the token once existed.
- **Public endpoint data**: `last_name` is never returned by `share.py`. Sensitive tags (`behavioural`, `needs-support`, `iep`, `medical`) are never returned. Use an allowlist (`WHITELISTED_TAGS`), not a denylist.
- **Auth error messages**: login must return identical errors for "user not found" and "wrong password" to prevent user enumeration.

---

## Per-router checklist

When implementing a router:

1. Load `docs/00_shared_context.md` + the relevant router spec from `docs/`.
2. Create the Pydantic schemas in `schemas/<domain>.py` before the router.
3. Apply `get_cohort_or_403` on every endpoint that touches cohort-scoped resources.
4. Apply `slowapi` rate limits per the spec.
5. Write field-level validators in the Pydantic schemas — do not validate in the router handler.
6. Match the HTTP status codes exactly as specified (201 for creates, 204 for deletes, 422 for validation/solver failures).

---

## Solver variants

| Label | Objective |
|---|---|
| `balanced_sizes` | Minimise class size variance only — ignore soft constraint penalties |
| `soft_priority` | Full weighted penalty minimisation (all soft constraints) |
| `diversity_mix` | Weighted penalty + tag-clustering penalty (penalise tag concentration per class) |

Label solutions by objective profile, not rank. Never label them "Solution 1, 2, 3".

---

## Services

| Service | Responsibility |
|---|---|
| `services/solver.py` | CP-SAT model construction and all three variant runs |
| `services/csv_import.py` | Parse teacher-uploaded CSV into `Student` rows; normalise name columns, surface row-level errors |
| `services/validator.py` | `detect_contradictions()` — find hard constraint pairs that are logically incompatible before invoking the solver |

---

## Common pitfalls

- `num_classes` for a solve run comes from `SolveRequest.num_classes` (resolved by the frontend), not from `cohort.num_classes`. Never trust the cohort field alone.
- Do not call Supabase `signup` only on register — the DB row must also be inserted. Both must succeed (or both must roll back).
- Do not use `Base.metadata.create_all()` — all schema changes go through Alembic.
- Do not share a `penalty_terms` list or `model` instance across solver variants.
- Rate limit the solve endpoint per teacher ID (not per IP), because teachers share school networks.
