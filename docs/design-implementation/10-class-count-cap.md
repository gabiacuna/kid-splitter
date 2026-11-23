# 10 · Class count cap & schema consolidation

**Scope:** backend + frontend · **Status:** cross-cutting change, do early

Two small changes that don't belong to any one screen but affect several.

## Cap `num_classes` at 2–4

`schemas/cohort.py` and `schemas/solve.py` both validate `num_classes` between **2 and 20**. The design assumes exactly **3** — structurally, not incidentally: three class-size bars, three gender bars, three accent colours, and a preference map whose clusters sit in a *triangle*.

A primary school splitting one grade is doing 2, 3, maybe 4 classes. The cap of 20 is a defensive round number, and it isn't free — it forces general-case work into the preference map layout, the colour palette, and bar readability, to serve cohorts that will never exist.

**Change both validators to 2–4.** This deletes:

- A 20-hue categorical palette requirement that isn't achievable while staying accessible.
- A preference-map layout that generalises to arbitrary N (see 08 — it stays parametric, but only across 2–4).
- Readability work on bar charts with 20 rows.

Check for other places the range is assumed: the `num_classes` input in `CreateModal`, the `EditModal` warning about re-solving (`cohorts.py:89`), and any test fixtures.

### The 4th colour

3 classes exhaust the design's class accents (teal, sage, lavender). A 4-class cohort needs one more, and `design.md` has assigned every remaining hue: coral is *separate / delete*, amber is *warning*.

**Decision: reuse coral as the 4th class colour** — this part holds. Coral is well-separated from the other three (never the worst pair in validation), and it carries "danger" only on *controls* (delete icons, destructive buttons, the Separate badge), never as an identity chip; no screen puts a coral delete button beside a coral class bar.

**But the `dataviz` check surfaced a bigger, pre-existing problem — RESOLVED here.** Running the current tokens through `scripts/validate_palette.js` (light mode, white card `#fff` and `--bg2` track, `--pairs all`) **fails**, and not because of coral:

- **`teal ↔ sage` are too close to tell apart.** Normal-vision ΔE **6.4** (the hard floor is 15) — even full-colour-sighted teachers can barely distinguish the two fills; under protanopia ΔE 5.4. This is worst exactly where it hurts: the segmented boys/girls bar (teal=boys, sage=girls, feature 07) and class 1 vs class 2 in the class-size bars.
- **teal/sage/lavender all fall below the chroma floor (0.10)** — the design's deliberately-muted OKLCH tokens read grayish to a categorical validator.

Two greens (teal + sage) **cannot** coexist in a 4-way categorical palette — brute-force search found no passing set that keeps both in the green family. One must become a warm hue. The validated fix replaces sage-green with **amber-gold** and lifts chroma:

| Class | Token (OKLCH) | Hex |
|---|---|---|
| 1 | `oklch(58% 0.13 190)` teal | `#00918b` |
| 2 | `oklch(75% 0.15 75)` amber | `#e49e22` |
| 3 | `oklch(50% 0.15 275)` indigo | `#4d57b7` |
| 4 | `oklch(58% 0.16 28)` coral | `#c74c41` |

This passes every check on both the white card and the `--bg2` bar track (worst normal-vision ΔE 19.8, worst CVD ΔE 11.2). The one WARN is amber's low contrast on the track (1.91); it's satisfied because every bar carries a text value + class-name label beside it — the "visible labels" relief the check requires. **App is light-mode only** (no `prefers-color-scheme` block in `index.css`), so no dark-mode validation was needed.

**Product implication — this is a real decision, not a token swap.** `sage` is not only class 2; it's also the "Together" constraint badge and the "Girls" gender segment. Retiring it as a *class* accent is safe (classes are pure identity), but decide whether those other two uses stay sage or move too. Recommended: keep sage for Together/Girls (they're never adjacent to a class bar of the same hue), and use amber only in the class palette. The gender bar then becomes teal(boys) vs sage(girls) as a **2-colour** pair — and that pair **fails on its own** (teal↔sage ΔE 6.4). Confirmed fix: **boys = teal `#00918b`, girls = amber `#e49e22`** (validated PASS as a 2-colour pair). Keep the 2px surface gap between the segments and the "5B / 4G" labels regardless, as belt-and-braces relief.

Class colour is load-bearing in the class-size bars, the roster table's class names, and the preference-map nodes — keep the assignment in **one** place, not duplicated per component.

## Fold migrations into the initial schema

There are two revisions today: `001_initial_schema.py` and `002_add_unary_constraint_tag.py`. This work adds `students.gender` (01) and `cohorts.balance_gender` (02).

**All of it goes into `001_initial_schema.py`, including `002`.**

Migration history is only valuable as a record of changes that real databases had to survive. Nothing here is deployed — there is exactly one database, on one machine, recreatable at will. Carrying `003_add_student_gender` forever would document a step that never happened to anything. An unreleased product gets one chance at a clean initial schema.

Cost: `alembic downgrade base && alembic upgrade head`, plus re-entering test data.

**This assumes no one else holds a copy of this database** — no collaborator, no staging environment, no Supabase project with real rows. If that's wrong, stop and use ordinary `003`/`004` revisions instead; folding would silently break any other copy.

## Verification

- `num_classes` of 5 is rejected by both the cohort and solve endpoints.
- A 4-class cohort renders distinct colours across bars, roster table, and preference map.
- `alembic downgrade base && alembic upgrade head` produces a schema containing `gender`, `balance_gender`, and the unary `tag` column, with no `002`/`003`/`004` revisions present.
