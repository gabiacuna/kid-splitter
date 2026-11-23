# Design Handoff Implementation — Overview

Source: `Kid's Class Scheduler UI/design_handoff_class_scheduler/` (README.md, design.md, screenshots/).

Decisions in these files were settled in a grilling session; each one is recorded in the feature file it affects, with its reasoning. Three items remain open — see the end.

## What already exists

The handoff assumes a greenfield build ("If no frontend environment exists yet, choose a framework"). It does not. Verified as **already done** before planning:

| Thing the handoff describes | Status |
|---|---|
| Design tokens (OKLCH colours, shadows, radii, Plus Jakarta Sans) | ✅ `frontend/src/index.css` `:root` — matches `design.md` exactly |
| Tab routing via `?tab=` query param | ✅ `CohortDetailPage.tsx:97-101` |
| Nav, breadcrumb, tab bar | ✅ `Nav.tsx`, `CohortDetailPage.tsx` |
| Cohort dashboard, card grid, create/edit/delete modals | ✅ `CohortDashboardPage.tsx` |
| Constraint CRUD (binary + unary), contradiction detection | ✅ `routers/constraints.py`, `services/validator.py` |
| 3 solver variants | ✅ `services/solver.py` |
| Solution cards, BEST badge, class-size bars | ✅ `SolutionsTab.tsx` |
| Class roster view | ✅ `SolutionDetailPage.tsx` (full page; design specifies a modal) |
| Sharing (tokens, public page, redaction) | ✅ `routers/share.py`, `ShareModal.tsx`, `PublicSharePage.tsx` — **the handoff never mentions this** |

So this is gap-closing, not rebuilding.

## Bugs found while planning

These predate the redesign and are worth fixing regardless of whether it proceeds.

| Bug | Where | Fixed in |
|---|---|---|
| **Every cohort shows "No solves yet"** — `CohortOut` never returns `last_solve_at`, so the frontend field is always `undefined` | `schemas/cohort.py:68-77` | [06](06-cohort-dashboard-redesign.md) |
| **A solvable cohort can be locked out of solving.** Greedy graph colouring is an *upper bound* on chromatic number, so `coloring_impossible` fires on 3-colourable graphs and returns a false 422 | `validator.py:88-103` → `solve.py:77` | [04](04-conflict-groups.md) |
| **Constraint highlighting flags innocent rules** — a student-level flag used as a rule-level one | `ConstraintEditorTab.tsx:308` | [04](04-conflict-groups.md) |

*(An earlier draft claimed the symlinks in `~/.claude/skills/` were broken. They aren't — that was a bad diagnosis from `find` not dereferencing a symlink start path. Removed.)*

## Feature files

| # | File | Backend | Frontend |
|---|---|---|---|
| 10 | [Class count cap & schema consolidation](10-class-count-cap.md) | ✅ | ✅ |
| 01 | [Student gender](01-student-gender.md) | ✅ | ✅ |
| 02 | [Cohort gender-balance flag](02-cohort-gender-balance-flag.md) | ✅ | ✅ |
| 03 | [Solver gender balance](03-solver-gender-balance.md) | ✅ | — |
| 04 | [Conflict groups & "Why?"](04-conflict-groups.md) | ✅ | ✅ |
| 05 | [Constraint editor redesign](05-constraint-editor-redesign.md) | — | ✅ |
| 06 | [Cohort dashboard redesign](06-cohort-dashboard-redesign.md) | ✅ | ✅ |
| 07 | [Solutions comparison redesign](07-solutions-redesign.md) | — | ✅ |
| 08 | [Class roster modal](08-class-roster-modal.md) | — | ✅ |
| 09 | [Roster export (.xlsx)](09-roster-export.md) | ✅ | ✅ |
| 11 | [Profile page: edit school, delete account](11-profile-page.md) | planned | planned |

## Sequencing

1. **10 first.** It consolidates the schema (requires recreating the dev DB) and caps `num_classes` — both cheaper before other work lands on top.
2. **01 → 02 → 03** as one branch. Gender is a vertical slice; splitting it leaves the DB half-built. Land 03's `gender_split` output before 03's solver changes, so the effect is observable while tuning.
3. **04 → 05** as one branch. The editor redesign is meaningless without the conflict-group data behind it.
4. **06**, **07**, **08 → 09** in parallel.

## Decisions

Full reasoning lives in the linked files.

**Gender**
- Model is `'boy' | 'girl' | null`. Students who are neither are `null`: excluded from balancing, placed freely.
- School CSVs *sometimes* include gender. So missing data is filled in via **click-to-cycle inline editing** in the student table — not a dedicated bulk screen.
- Partial data **never blocks solving**. The prompt to complete lives in the Students tab; a disclosure line under the Solutions gender bars states the unknown count.
- Gender balance rides `include_soft` → applies to `soft_priority` and `diversity_mix`, **not** `balanced_sizes`.
- It is a **tiebreaker**: weighted an order of magnitude below the lowest constraint weight, and never breaks an explicit preference. Assertable pass condition.
- Gender deviation does not feed the "Soft violations" chip.

**Constraints**
- `coloring_impossible` becomes an exact CP-SAT check, time-limited, permissive on timeout.
- Badge number = **conflict group ID**, not row position. Row numbers shift under edits and don't scale past one conflict.
- The editor **autosaves** (debounced ~500ms, deferred revalidation, new rows client-side until complete). The design's grid has no room for a Save button, and explicit-save loses work silently after a slider drag.
- Unary constraints kept, behind a collapsed "Advanced" disclosure.
- Weight slider widens to 1–10; no data migration needed.

**Structure**
- `num_classes` capped at **2–4**.
- Schema folded into `001_initial_schema.py`, including `002`; dev DB recreated.
- Both roster surfaces kept — modal is the fast path, `/solutions/:id` retained because it is the only route to sharing.
- Export is server-side `.xlsx`, one file per solution.
- Dashboard Draft/Active inferred from solve history.
- 4th class colour is coral — but `dataviz` validation forced a wider palette change: sage-green retired from the class palette (too close to teal), replaced by amber. Validated set teal/amber/indigo/coral. See [10](10-class-count-cap.md).

## Deviations from the handoff (deliberate)

- **Export format.** The prototype ships a CSV named `.xls`, which makes Excel show a security warning. The handoff itself flags it as prototype-grade.
- **Badge semantics.** The handoff contradicts itself — prose says badges are shared group IDs, sample data uses row numbers. Group IDs chosen.
- **Sharing survives.** The handoff's silence about it reflects its three-screen scope, not a decision to remove it.
- **Unary constraints survive**, demoted rather than deleted.
- **Sample data is not spec.** Student names, scores, and contradiction rows are prototype fixtures; everything renders from real API data.

## Resolved (were open)

2. **Card subtitle copy — DONE** (see [07](07-solutions-redesign.md)). Final copy: `balanced_sizes` → *"Most equal class sizes — ignores preferences"*; `soft_priority` → *"Best honours your together/apart preferences"*; `diversity_mix` → *"Honours preferences, spreads flagged students"*. The dash-clause is the mitigation for `balanced_sizes` showing worse gender bars.
3. **4-colour palette — VALIDATED, and it changed the plan** (see [10](10-class-count-cap.md)). The `dataviz` validator **fails the current tokens**: `teal ↔ sage` are indistinguishable (normal-vision ΔE 6.4 vs a hard floor of 15), and teal/sage/lavender all fall below the chroma floor. Coral (the 4th) is fine — the real defect is pre-existing. Fix: retire sage-green from the *class* palette in favour of amber; validated set is teal `#00918b` / amber `#e49e22` / indigo `#4d57b7` / coral `#c74c41` (passes all checks on white card + `--bg2` track). Gender bar (teal boys / sage girls) also fails on its own → use boys=teal, girls=amber. App is light-mode only, so no dark validation needed. **One product decision remains inside this:** sage is also the "Together" badge and the "Girls" segment — recommended to keep sage there and use amber only for classes, but confirm.

## Still open

1. **Constraint editor column order.** The design moves Type into its own badge column (`A | B | Type | Hard | Weight`); today it sits between the students, reading as prose ("Amara — Together — Ben"). **Recommendation: follow the design** — scanning down a long list is the actual task, and a row-as-sentence doesn't scale past a handful of rows. This is a ~5-line CSS-grid change and fully reversible, so it need not block implementation; spot-check both in a browser when 05 lands and flip the grid template if the sentence reading wins.
