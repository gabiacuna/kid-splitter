# 06 · Cohort dashboard redesign

**Scope:** frontend + small backend · **Status:** redesign + one bug fix

Reference: `screenshots/dashboard.png`. Target: `CohortDashboardPage.tsx` (321 lines).

## Bug fix: every cohort says "No solves yet"

**Independent of the redesign; fix regardless.**

`CohortOut` (`schemas/cohort.py:68-77`) returns id, name, year, num_classes, student_count, created_at, updated_at — **no `last_solve_at`**. The frontend `Cohort` type declares `last_solve_at?: string | null`, so it is always `undefined`, and line ~299 renders:

```ts
formatDate(c.last_solve_at) ?? 'No solves yet'
```

Every cohort on the dashboard reads "No solves yet", solved or not. The design's "Last solved X ago" line depends on this field, and the Draft/Active rule below depends on it too.

**Fix:** add `last_solve_at` to `CohortOut` as `MAX(solutions.created_at)`, folded into the existing join at `routers/cohorts.py:40`. A correlated subquery per cohort would be an N+1.

## Status: Draft vs Active — decided

**Inferred from solve history.** Never solved → Draft. Has solves → Active. No new column, no new UI, and it tells the teacher something actionable.

The handoff's sample data doesn't define this coherently — "5th Grade 2026 (31 students, **Draft**, 3 weeks ago)" is marked Draft while having a solve time, yet the separately-described empty-state card is the one with no solves. Those can't both be the rule; the 5th-grade sample is an inconsistency in the mock.

The two states collapse cleanly onto the two card treatments the design already draws:

| Condition | Treatment |
|---|---|
| No solves | Empty-state card (dashed 2px border, muted inset "No solves yet — Add constraints and run your first solve", ghost button), "Draft" pill (lavender) |
| Has solves | Normal card, "Active" pill (sage), "Last solved X ago" |

An explicit teacher-set status was rejected: it asks teachers to maintain metadata the app can derive, and the first question it raises — "what does Draft stop me doing?" — has no good answer.

## Card anatomy

White, 14px radius, card shadow, 24px padding, flex column, 14px gap:

- Top row: 40×40px icon square (10px radius, hue-tinted) + status pill top-right.
- Cohort name (17px/700) + `"N students · N classes"` (13px, `--text3`).
- `"Last solved X ago"` (12.5px, `--text3`, value bold in `--text2`).
- Full-width "Open →" primary button.

Grid: `repeat(auto-fill, minmax(260px, 1fr))`, 18px gap, 1 column at ≤640px.

## Relative time

"Last solved 2 days ago" — current code renders an absolute date. Write a small `timeAgo()` helper in `frontend/src/lib/`; day/week/month granularity is all the design shows. Don't add a date library for this.

## Icon tint

Cards use different hue tints and nothing in the data implies one. Derive deterministically from cohort ID (hash → index into the accent palette) so a cohort keeps its colour across reloads. Index-in-array would reshuffle whenever a cohort is created or deleted.

## Keep

- `EditModal` and `DeleteModal` — not in the design, but working. The design's card has no affordance for either; add a small menu or keep the current controls restyled.
- "New cohort" primary button with `+` icon, restyled.
- `EditModal` also gains the gender-balance checkbox — see 02.

## Verification

- Dashboard with zero cohorts, one never-solved, one solved → all three states correct.
- **A solved cohort shows a real date, not "No solves yet"** — the bug fix.
- Resize to ≤640px → one column.
- Create a cohort, reload, confirm its icon tint didn't change.
