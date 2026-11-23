# 03 · Solver gender balance + gender split in output

**Scope:** backend · **Needs:** 01, 02 · **Blocks:** 07 · **Status:** new capability

Two separable pieces:

- **A** — the solver optimises for gender balance when `cohort.balance_gender` is on.
- **B** — every solution reports its per-class gender split, regardless of the flag.

Land **B first**. It's smaller, lower-risk, informative even for cohorts that never asked for balancing, and it makes A's effect observable — you can't tune A without it.

## B · `gender_split` on solution output

Handoff: *"each solution's `classSizes[]` should also carry a `genderSplit[]` (boys/girls count per class)"*.

**Do not persist it.** It's derivable from `class_assignments` joined to `students.gender`, and a stored copy goes stale the moment a teacher corrects a student's gender via the click-cycle in 01. Compute on read.

`backend/app/schemas/solve.py`:

```python
class GenderSplit(BaseModel):
    class_number: int
    boys:         int
    girls:        int
    unknown:      int
```

`gender_split: list[GenderSplit]` on `SolutionOut`.

`backend/app/routers/solve.py` — populate in the `GET /cohorts/{id}/solutions` and `GET /solutions/{id}` response builders.

**Watch the N+1.** The list endpoint returns 3 solutions; a per-solution student query is 3 extra round-trips. Load the cohort's students once and tally in Python against the already-loaded assignments.

`unknown` is carried explicitly rather than folded into either bucket. The UI needs to distinguish "no gender data" from "genuinely zero girls" — see 07, where the unknown count drives a disclosure line under the bars.

## A · Gender balance as a soft constraint

Read `solver.py` end to end first — particularly the `both_in_k` encoding for soft binary constraints and `_count_soft_violations()`. The penalty below must match the existing objective's sign and scale conventions.

### Which variants — decided

`solver.py:279-282`:

```python
variants = [
    ("balanced_sizes", False, False),
    ("soft_priority",  True,  False),
    ("diversity_mix",  True,  True),
]
```

These are `(label, include_soft, include_diversity)`. **Gender balance rides `include_soft`** — so `soft_priority` and `diversity_mix` get it, `balanced_sizes` does not.

The design decides this itself: its checkbox copy reads *"Added as a soft constraint the solver weighs alongside your other preferences."* Gender balance **is** a soft constraint; `balanced_sizes` excludes soft constraints by construction; therefore it excludes this one, for the same reason and with the same explanation. Implementation is free — the penalty term goes inside the existing `include_soft` branch, no new plumbing.

Consequence to mitigate in the UI: a teacher who ticked the box will see the "Balanced sizes" card show worse gender bars than the other two, with nothing explaining why. Fixed with copy, not solver logic — see the card-subtitle item in 07.

### Encoding

Gender balance isn't pairwise, so it doesn't fit the binary-constraint machinery. It's a per-class deviation penalty:

- For each class `k`: `boys_k = sum(x[i][k] for i in boys)` — a linear expression over existing assignment booleans.
- Target `t_k = round(total_boys / num_classes)`.
- Introduce `dev_k >= 0` with `dev_k >= boys_k - t_k` and `dev_k >= t_k - boys_k` (standard CP-SAT absolute-value linearisation).
- Add `GENDER_BALANCE_WEIGHT * sum(dev_k)` to the objective's penalty term.

Only boys need constraining — class sizes are already fixed by the size constraints, so girls follow. Constraining both is redundant and double-counts the same deviation.

**Students with `gender = null` are excluded** from both the tally and the target. They float freely, which is correct: the solver must not be told an unknown is a boy.

### Weighting — decided: tiebreaker only

**Gender balance must never break an explicit preference.** Set `GENDER_BALANCE_WEIGHT` an order of magnitude below the lowest usable constraint weight (constraint weights are 0.1–10.0 per `schemas/constraint.py`). It shapes placement of students who aren't otherwise constrained, and loses to any together/separate rule.

The reasoning: those pairs are the one place the teacher has specific, personal knowledge — *this kid needs to be with that kid* — often with a real promise behind it. Gender balance is a diffuse structural preference over the whole cohort. When a diffuse preference silently overrides a specific one, the teacher doesn't perceive a trade-off, they perceive a bug: "I told it to keep them together and it didn't." Worst case under this weighting is a somewhat lopsided class, which is visible in the bars and fixable by hand. The alternative's worst case is a broken promise to a child, invisible unless every pair is checked by hand.

Note the units don't line up: a violated preference costs its weight (one number), while gender balance costs a *sum of per-class deviations* that grows with roster size and class count. So the constant must be **calibrated against the behaviour above**, not just set to a small-looking number. Define it as a named module-level constant.

**Pass condition, and it's assertable:** no hard or soft preference is ever violated solely to improve gender balance. This crispness is a large part of why this weighting was chosen — the alternatives can only be evaluated by eyeballing outputs.

### Violation counting

Gender deviation does **not** feed `soft_violations`. As a tiebreaker it has no discrete promise to break, and the "Soft violations" chip on the solution card keeps its current meaning: preferences the solver couldn't honour.

## Verification

Run the solver on real cohorts, not just unit tests:

- 24 students, 12/12, 3 classes, flag **off** → note the splits.
- Same cohort, flag **on** → splits move toward 4/4 per class.
- **A cohort with a dense friend-pair network plus the flag on → no pair is split.** This is the pass condition for the weighting; if pairs break, the constant is too high.
- Hard constraints still respected with the flag on.
- Every student `gender: null` and flag on → no crash, no division by zero, behaves identically to flag-off.
- Partial gender data (12 of 28) → solver balances the knowns, unknowns float, `gender_split` reports the unknown count accurately.
