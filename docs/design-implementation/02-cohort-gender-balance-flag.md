# 02 · Cohort gender-balance flag

**Scope:** backend + frontend · **Needs:** 01 · **Blocks:** 03 · **Status:** new capability

Handoff, "New Cohort Modal — Gender Balance Toggle":

> Below the existing "List includes grouping preferences" checkbox, a second checkbox: "Prioritize a balanced mix of boys and girls per class" with helper caption "Added as a soft constraint the solver weighs alongside your other preferences."

Per-cohort setting, persisted on the cohort.

## Backend

**Schema** — into `001_initial_schema.py`, `cohorts` table (no migration file; product is undeployed):

```sql
balance_gender BOOLEAN NOT NULL DEFAULT FALSE
```

Non-nullable with a default, unlike gender in 01 — there's no meaningful "unknown" state for a toggle.

**Model** — `backend/app/models/cohort.py`:

```python
balance_gender: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
```

**Schemas** — `backend/app/schemas/cohort.py`: add to `CohortCreate` (default `False`), `CohortUpdate` (`Optional[bool] = None`), `CohortOut`.

Note this field does *not* have 01's `null`-vs-absent problem — a boolean has no third state, so the standard `Optional[bool] = None` partial-update convention works unchanged.

**Router** — `backend/app/routers/cohorts.py`: pass through on create; add to the partial-update field list on `PUT`, following the existing pattern in that file.

No solver work here — that's 03. This file only makes the flag exist and persist.

## Frontend

**Types** — `frontend/src/lib/types.ts`: `balance_gender: boolean` on `Cohort`.

**New cohort modal** — `CohortDashboardPage.tsx`, `CreateModal` (line ~19):

- Checkbox with the handoff's exact copy: "Prioritize a balanced mix of boys and girls per class", helper caption "Added as a soft constraint the solver weighs alongside your other preferences." (12px, `--text3`).
- Include `balance_gender` in the `mutation.mutate({...})` payload at line ~49.
- Reference: `screenshots/new-cohort-modal.png`.

That caption is worth keeping verbatim — "soft constraint … weighs alongside your other preferences" is exactly the behaviour decided in 03, where gender balance acts as a tiebreaker that never overrides an explicit preference. The copy already sets the right expectation.

**On the sibling checkbox.** The handoff positions this below an existing "List includes grouping preferences" checkbox. That checkbox doesn't exist in `CreateModal` — the create flow is name / year / num_classes only, and grouping-preference parsing happens later in the CSV import step (`CsvUpload.tsx`). Don't add a fake sibling to match the mock. Place the gender checkbox as the last field and leave the import flow alone.

**Edit modal.** `EditModal` (line ~113) is rename-only today. A teacher who skipped the toggle at creation has no way to set it, and re-running the solver is exactly when they'd want to. Add the same checkbox there, wired to `PUT /cohorts/{id}`. Small extension beyond the handoff — which only shows the create modal — justified because the alternative is deleting and recreating a cohort.

## Verification

- Create with the box checked, reload, reads back checked.
- Create unchecked → `false`, not `null`.
- Toggle via the edit modal, reload, persists.
