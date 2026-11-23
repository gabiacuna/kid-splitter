# 04 · Conflict groups & the "Why?" explanation

**Scope:** backend + frontend · **Blocks:** 05 · **Status:** substantial backend change + one bug fix

The most interesting feature in the handoff and the largest gap to what exists.

## The gap

`detect_contradictions()` (`services/validator.py`) returns:

```python
Contradiction(type, message, student_ids: list[str])
```

The frontend then does (`ConstraintEditorTab.tsx:308`):

```ts
const contradictionIds = new Set(contradictions.flatMap((c) => c.student_ids));
```

…and highlights a row if **either** of its students appears in that set. That's a student-level flag masquerading as a rule-level one:

- **Over-highlighting.** A `cluster_overflow` can name 12 students, flagging every rule touching any of them — including rules that are individually fine.
- **No cross-referencing.** The design's central mechanic is numbered badges shared by the rules in one conflict, so a teacher can trace *which rule fights which*. Impossible without rule identity.
- **Messages name UUIDs.** `f"Students {pair[0]} and {pair[1]} have both hard TOGETHER..."` interpolates raw student IDs.

The handoff is explicit that this must be computed: *"the row badge numbers should be derived from the same computed conflict-group data (a list of conflicting rule-id groups), not authored separately."*

## Bug fix: `coloring_impossible` can block a solvable cohort

**Independent of the redesign; fix regardless.**

`validator.py:88-103` greedy-colours the hard-separate graph and reports a contradiction when it needs more colours than there are classes. Greedy colouring — even with the degree-descending ordering used there — is an **upper bound** on chromatic number, not the true value. It can use 4 colours on a genuinely 3-colourable graph. When it does, `solve.py:77` throws a 422 and tells the teacher:

> "Hard SEPARATE constraints require at least 4 classes but only 3 are configured"

That sentence is false, and the teacher is locked out of a cohort that has a perfectly good solution, with no recourse but deleting rules at random until the message disappears. The other two hard detectors are exact; this is the only one that guesses.

**Fix: make it exact via CP-SAT.** Ortools is already a dependency; graph-colouring feasibility is a small model. Keeps the fast explanatory pre-check while removing false positives.

- Time-limit the check. Exact colouring is NP-hard in general, though trivial at this scale (≤4 classes, ≤500 students).
- On timeout: **allow the solve.** A pre-check that can't decide must not block; the real solver is the backstop and `solve.py:108` already returns 422 on genuine infeasibility.
- Exactness proves the *set* is unsatisfiable, not who's to blame — so the explanation must not accuse any single rule. See the copy note below.

**Correction to an earlier draft of this file:** it claimed soft warnings block solving. They don't — `solve.py:75` already filters them out with `hard = [c for c in contradictions if c.type != "soft_warning"]`. No change needed there.

## Backend

**New shape** — `services/validator.py`:

```python
@dataclass
class ConflictGroup:
    id:             int        # 1-based; the badge number
    type:           str        # direct_conflict | cluster_overflow | coloring_impossible | soft_warning
    severity:       str        # "hard" (blocks solving) | "soft" (advisory)
    constraint_ids: list[str]  # THE new field — which rules are in this conflict
    student_ids:    list[str]  # kept, still useful
    explanation:    str        # plain language, real names, no UUIDs, no row numbers
```

Each detector reworked to track which constraints it consumed:

- **Direct conflict** — currently reduces constraints to a `set` of pairs, losing identity. Keep a `dict[pair, list[constraint]]` and emit both constraint IDs.
- **Cluster overflow** — the BFS builds a component from together-edges. Record the constraint ID per edge traversed; the group is every constraint forming that component. Can be large — see truncation.
- **Coloring impossible** — now exact (above). Return the constraints in the over-constrained component. Do **not** attempt a minimal unsatisfiable subset; disproportionate for the payoff.
- **Soft warning** — the A-B / B-C / A-C triple already identifies three pairs; emit those three IDs.

**Explanation text** is built in the validator — one source of truth, shared by all API consumers. That means the validator needs student names, which it doesn't receive today (only constraints). Pass a `dict[student_id, display_name]` from the router, which already has the cohort's students loaded.

Copy rules:

- Name **students**, never row positions. See the badge decision below.
- For `coloring_impossible`, describe the group collectively — *"these 7 rules together need 4 classes; you have 3"* — rather than implying any one rule is at fault, and point at the real remedies (add a class, or remove one of these rules).

**API** — `GET /cohorts/{id}/constraints/validate` gains `conflict_groups: list[ConflictGroup]`.

Keep the existing `contradictions` array for one release. `routers/solve.py` also reads validator output; changing the shape underneath it in the same commit turns one reviewable change into a cross-cutting one. Drop the old field in a follow-up.

## Badge semantics — decided

**The badge number is the conflict group ID.** Every rule in one conflict shows the same number; a second conflict gets ②.

The handoff contradicts itself here. It states:

> Every row involved in the same contradiction **shares a badge number** (row cross-referencing)

…but its sample data gives the two rows of a *single* contradiction **different** numbers (Amara↔Ben "badge 1", George↔Amara "badge 4"), and the explanation reads *"Row 1 requires… Row 4 requires…"* — i.e. badges as row positions. Both mechanics can't be built.

Group IDs win for two reasons:

1. **Row numbers are unstable.** Delete a rule and every number below it shifts, so explanation text the teacher just read now points at the wrong rows — and they're *actively editing that list*.
2. **Row numbers don't scale past one conflict.** With two contradictions, badges ①②③④ say nothing about which rules fight which. That's precisely the work badges exist to eliminate, and the handoff's own stated goal — *"so a teacher can visually trace which rules conflict"* — is only met by grouping.

The cost: explanations can't say "Row 1". They name students — *"Amara O. and Ben K. must be together, but George P. and Amara O. must be apart"* — which is why the validator needs the name map.

## Frontend

**Types** — `frontend/src/lib/types.ts`: add `ConflictGroup`; keep `Contradiction` until the backend field is dropped.

**Constraint editor** — `ConstraintEditorTab.tsx`:

- Replace the student-ID set with a `Map<constraintId, groupId>` built from `conflict_groups`. A row's badge is its group ID; a row absent from the map is not highlighted.
- A constraint can belong to more than one group — render the lowest group number; don't over-engineer multi-badge until it appears in practice.
- Banner: `"N contradiction(s) found — resolve before solving."` with the "Why?" / "Hide" toggle (13px/700, `--warn-text`, underlined, right-aligned). Expanded panel below the message row, separated by `1px solid var(--warn-border)`, rendering each group's `explanation` plus numbered pill chips matching the row badge colours.
- Row badge: 18px circular, amber bg, white number, overlaid top-left. Needs `position: relative` on the row and a negative offset — check it doesn't clip against row `overflow` or collide with the first `<select>` at narrow widths.

**Truncation.** A cluster-overflow group can hold dozens of constraints. Cap both the chip list and the explanation (show ~5, then "+7 more") or the banner pushes the editor off-screen. The prototype's 2-rule sample never exercises this.

## Verification

Build each case as real data in a scratch cohort:

- Hard together + hard separate on the same pair → one group, exactly 2 rules badged ①.
- Two independent conflicts → groups ① and ②, no badge bleed.
- **A rule sharing a student with a conflict but not part of it → not highlighted.** This is the specific regression in the current code.
- Cluster overflow with 15 students → chip truncation works, banner stays readable.
- Soft-warning only → banner shows, solving still permitted.
- **A 3-colourable separate-graph that greedy colouring would call impossible → solving is now permitted.** This is the bug fix; construct the case deliberately.
