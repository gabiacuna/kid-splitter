# Router Spec — `solve.py`

> **Prereq:** Load `00_shared_context.md` first.  
> **File:** `backend/app/routers/solve.py`  
> **Dependencies used:** `get_db`, `current_teacher`, `get_cohort_or_403`  
> **Services used:** `services/solver.py`, `services/validator.py`  
> **Rate limit:** Max 10 solves per teacher per hour (via `slowapi`)

---

## Responsibility

Trigger the OR-Tools CP-SAT solver for a cohort, persist the 2–3 solution variants, and expose solution read/delete endpoints. The solver runs synchronously inside a FastAPI background task or a thread pool executor to avoid blocking the event loop.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/cohorts/{id}/solve` | Required | Run solver → persist + return 2–3 solutions |
| GET | `/cohorts/{id}/solutions` | Required | List solutions for cohort |
| GET | `/solutions/{id}` | Required | Full solution + assignments + metrics |
| DELETE | `/solutions/{id}` | Required | Delete a solution |

> **Endpoint fix:** The architecture doc references `POST /solutions/generate` — this is incorrect. The correct endpoint is `POST /cohorts/{id}/solve` as listed in the API endpoints section. Use this spec.

---

## SQLAlchemy models — `models/solution.py`

```python
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Float, Integer, Boolean, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from ..db import Base
import uuid

class Solution(Base):
    __tablename__ = "solutions"

    id:              Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    cohort_id:       Mapped[str] = mapped_column(String, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    label:           Mapped[str | None] = mapped_column(String, nullable=True)
    score:           Mapped[float | None] = mapped_column(Float, nullable=True)
    hard_violations: Mapped[int | None] = mapped_column(Integer, nullable=True)   # must always be 0
    soft_violations: Mapped[int | None] = mapped_column(Integer, nullable=True)
    share_token:     Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    share_enabled:   Mapped[bool] = mapped_column(Boolean, default=False)
    solver_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at:      Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:      Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    assignments = relationship("ClassAssignment", back_populates="solution", cascade="all, delete-orphan")
    cohort      = relationship("Cohort", back_populates="solutions")


class ClassAssignment(Base):
    __tablename__ = "class_assignments"
    __table_args__ = (
        # One class per student per solution
        {"schema": None},  # replace with UniqueConstraint if needed
    )

    id:           Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    solution_id:  Mapped[str] = mapped_column(String, ForeignKey("solutions.id", ondelete="CASCADE"), nullable=False)
    student_id:   Mapped[str] = mapped_column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    class_number: Mapped[int] = mapped_column(Integer, nullable=False)   # 1-indexed

    solution = relationship("Solution", back_populates="assignments")
```

Add `UniqueConstraint("solution_id", "student_id")` to `ClassAssignment` via Alembic migration.

---

## Pydantic schemas — `schemas/solve.py`

### Request schemas

```python
from pydantic import BaseModel, field_validator
from typing import Optional

class SolveRequest(BaseModel):
    num_classes: int   # always pass the resolved value after distribution toggle logic

    @field_validator("num_classes")
    @classmethod
    def valid_num_classes(cls, v: int) -> int:
        if v < 2 or v > 20:
            raise ValueError("num_classes must be between 2 and 20")
        return v
```

### Response schemas

```python
from datetime import datetime

class AssignmentOut(BaseModel):
    student_id:   str
    class_number: int

class SolverMetadata(BaseModel):
    wall_time_s:     float
    objective_value: Optional[int]    # None if INFEASIBLE
    status:          str              # 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN'

class SolutionOut(BaseModel):
    id:              str
    cohort_id:       str
    label:           str
    score:           float
    hard_violations: int
    soft_violations: int
    share_enabled:   bool
    solver_metadata: SolverMetadata
    created_at:      datetime

    model_config = {"from_attributes": True}

class SolutionDetailOut(SolutionOut):
    assignments: list[AssignmentOut]  # full roster

class SolveResponse(BaseModel):
    solutions: list[SolutionOut]      # 2–3 variants
```

### Field summary

| Schema | Field | Type | Required | Notes |
|---|---|---|---|---|
| SolveRequest | num_classes | int | ✅ | 2–20; resolved by frontend before sending |
| SolutionOut | hard_violations | int | — | Must always be 0 in a persisted solution |
| SolutionOut | score | float | — | Lower is better |
| SolverMetadata | status | str | — | `OPTIMAL` preferred; `FEASIBLE` if 8s timeout hit |

---

## Business logic — solve endpoint

### `POST /cohorts/{id}/solve`

1. Use `get_cohort_or_403`.
2. Validate body as `SolveRequest`.
3. **Pre-checks** (reject with `422` if any fail):
   - `num_classes >= 2` (already validated by Pydantic)
   - `total_students > num_classes` — can't have more classes than students
   - Run `validator.detect_contradictions(...)` — if any hard contradictions exist, return `422` with the contradiction list. Do not proceed to solve.
4. Run the solver in a thread pool executor (don't block the async event loop):
   ```python
   import asyncio
   from concurrent.futures import ThreadPoolExecutor
   loop = asyncio.get_event_loop()
   results = await loop.run_in_executor(executor, run_solver, cohort_data)
   ```
5. Persist each solution + its assignments in a single transaction.
6. Return `201` with `SolveResponse`.

**Rate limit:** `@limiter.limit("10/hour")` keyed on `current_teacher.id`.

---

## Solver service — `services/solver.py`

### Integer weight scaling

CP-SAT's objective only accepts integers. Scale all float weights before building the model:

```python
WEIGHT_SCALE = 100   # multiply all weights by this; store as int

def scale(weight: float) -> int:
    return max(1, round(weight * WEIGHT_SCALE))
```

### Decision variables

```python
from ortools.sat.python import cp_model

model = cp_model.CpModel()

# x[student_id][k] = 1 if student is in class k
x = {}
for s in student_ids:
    for k in range(num_classes):
        x[s, k] = model.NewBoolVar(f'x_{s}_{k}')
```

### Each student in exactly one class

```python
for s in student_ids:
    model.AddExactlyOne(x[s, k] for k in range(num_classes))
```

### Class size balance

```python
min_size = total // num_classes
max_size = (total + num_classes - 1) // num_classes

for k in range(num_classes):
    model.Add(sum(x[s, k] for s in student_ids) >= min_size)
    model.Add(sum(x[s, k] for s in student_ids) <= max_size)
```

### Hard binary constraints

```python
# Hard together: A and B must be in the same class
for k in range(num_classes):
    model.Add(x[a, k] == x[b, k])

# Hard separate: A and B must not be in the same class
for k in range(num_classes):
    model.Add(x[a, k] + x[b, k] <= 1)
```

### Soft binary constraints

> **Fix from handoff doc:** The original soft-together encoding was broken — it used `AddBoolOr` to *allow* `same_class = 1` but nothing *forced* it to be 1. The solver would exploit this by leaving `same_class = 0` and absorbing the penalty without actually separating the students, making the constraint meaningless. The correct encoding uses per-class `both_in_k` booleans and binds `same_class` to their disjunction.

```python
# Soft together: penalize if A and B are NOT in the same class
def add_soft_together(model, x, a, b, weight, num_classes, penalty_terms):
    in_same_k = []
    for k in range(num_classes):
        both_in_k = model.NewBoolVar(f'both_{a}_{b}_{k}')
        model.AddBoolAnd([x[a, k], x[b, k]]).OnlyEnforceIf(both_in_k)
        model.AddBoolOr([x[a, k].Not(), x[b, k].Not()]).OnlyEnforceIf(both_in_k.Not())
        in_same_k.append(both_in_k)

    same_class = model.NewBoolVar(f'same_{a}_{b}')
    model.AddBoolOr(in_same_k).OnlyEnforceIf(same_class)
    model.AddBoolAnd([b_var.Not() for b_var in in_same_k]).OnlyEnforceIf(same_class.Not())

    # Penalty = weight when NOT same class (i.e. same_class = 0)
    penalty_terms.append(scale(weight) * (1 - same_class))


# Soft separate: penalize if A and B ARE in the same class
def add_soft_separate(model, x, a, b, weight, num_classes, penalty_terms):
    in_same_k = []
    for k in range(num_classes):
        both_in_k = model.NewBoolVar(f'both_{a}_{b}_{k}')
        model.AddBoolAnd([x[a, k], x[b, k]]).OnlyEnforceIf(both_in_k)
        model.AddBoolOr([x[a, k].Not(), x[b, k].Not()]).OnlyEnforceIf(both_in_k.Not())
        in_same_k.append(both_in_k)

    together = model.NewBoolVar(f'together_{a}_{b}')
    model.AddBoolOr(in_same_k).OnlyEnforceIf(together)
    model.AddBoolAnd([b_var.Not() for b_var in in_same_k]).OnlyEnforceIf(together.Not())

    # Penalty = weight when together
    penalty_terms.append(scale(weight) * together)
```

### Soft unary constraints

```python
# small_class: penalize if student is placed in a class larger than min_size
def add_soft_small_class(model, x, student, weight, student_ids, num_classes, min_size, penalty_terms):
    for k in range(num_classes):
        class_size = model.NewIntVar(0, len(student_ids), f'size_{k}')
        model.Add(class_size == sum(x[s, k] for s in student_ids))
        too_large = model.NewBoolVar(f'too_large_{student}_{k}')
        model.Add(class_size > min_size).OnlyEnforceIf(too_large)
        model.Add(class_size <= min_size).OnlyEnforceIf(too_large.Not())
        # Penalize if student is in this class AND it's too large
        both = model.NewBoolVar(f'sl_both_{student}_{k}')
        model.AddBoolAnd([x[student, k], too_large]).OnlyEnforceIf(both)
        model.AddBoolOr([x[student, k].Not(), too_large.Not()]).OnlyEnforceIf(both.Not())
        penalty_terms.append(scale(weight) * both)


# max_flagged_peers: at most N peers with a given tag in the same class
def add_max_flagged_peers(model, x, student, tag, parameter, student_ids, tags_map, num_classes, is_hard, weight, penalty_terms):
    flagged = [s for s in student_ids if tag in tags_map[s] and s != student]
    for k in range(num_classes):
        peer_count_in_k = sum(x[s, k] for s in flagged)
        if is_hard:
            # Hard: never allow more than `parameter` flagged peers in same class as this student
            # The +x[student,k] slack: limit only applies when this student is in k
            # Use OnlyEnforceIf pattern:
            model.Add(peer_count_in_k <= parameter).OnlyEnforceIf(x[student, k])
        else:
            excess = model.NewIntVar(0, len(flagged), f'excess_fp_{student}_{k}')
            model.AddMaxEquality(excess, [peer_count_in_k - parameter, model.NewConstant(0)])
            in_k = x[student, k]
            excess_if_here = model.NewIntVar(0, len(flagged), f'excess_here_{student}_{k}')
            model.Add(excess_if_here == excess).OnlyEnforceIf(in_k)
            model.Add(excess_if_here == 0).OnlyEnforceIf(in_k.Not())
            penalty_terms.append(scale(weight) * excess_if_here)
```

### Objective

```python
model.Minimize(sum(penalty_terms))
```

### Three solution variants

Run the solver 3 times with different objectives. Each call builds a fresh model.

| Label | Objective | Description |
|---|---|---|
| `balanced_sizes` | Minimize class size variance only; ignore soft constraint penalties | Maximize equality of class sizes |
| `soft_priority` | Full weighted penalty minimization (all soft constraints) | Default — respects all teacher preferences |
| `diversity_mix` | Weighted penalty + tag-clustering penalty | Penalize concentration of any tag in a single class |

For `diversity_mix`, add per-tag excess penalty:
```python
# For each tag t, penalize if count(tag t in class k) > avg(tag t per class)
for tag in all_tags:
    tagged_students = [s for s in student_ids if tag in tags_map[s]]
    if not tagged_students:
        continue
    avg_per_class = len(tagged_students) / num_classes  # float
    for k in range(num_classes):
        count_in_k = sum(x[s, k] for s in tagged_students)
        excess = model.NewIntVar(0, len(tagged_students), f'excess_{tag}_{k}')
        # excess = max(count_in_k - floor(avg_per_class), 0)
        model.AddMaxEquality(excess, [count_in_k - int(avg_per_class), model.NewConstant(0)])
        penalty_terms.append(DIVERSITY_WEIGHT * excess)  # DIVERSITY_WEIGHT = 50 (integer)
```

### Solver execution

```python
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = 8.0
status = solver.Solve(model)

STATUS_MAP = {
    cp_model.OPTIMAL:   "OPTIMAL",
    cp_model.FEASIBLE:  "FEASIBLE",
    cp_model.INFEASIBLE:"INFEASIBLE",
    cp_model.UNKNOWN:   "UNKNOWN",
}
```

If status is `INFEASIBLE` or `UNKNOWN`, do not persist that variant — return it with a flag in `solver_metadata`. If all 3 variants fail, return `422` with infeasibility details.

### Extracting assignments

```python
if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    assignments = []
    for s in student_ids:
        for k in range(num_classes):
            if solver.Value(x[s, k]) == 1:
                assignments.append({"student_id": s, "class_number": k + 1})
                break
```

---

## Scoring

After solving, compute `score` and `soft_violations` for display:

```python
score = solver.ObjectiveValue() / WEIGHT_SCALE  # scale back to float
hard_violations = 0  # always — hard constraints are enforced, not penalized
soft_violations = count_violated_soft_constraints(solver, model_vars, constraints)
```

`hard_violations` must always be 0. If it isn't (shouldn't happen with correct hard constraint encoding), log an error and do not persist.

---

## DO NOTs

- **Do not** use `model.Minimize()` with raw Python `float` weights — CP-SAT requires integers. Always scale via `WEIGHT_SCALE`.
- **Do not** run the solver on the async event loop thread — use `loop.run_in_executor()` to avoid blocking all concurrent requests.
- **Do not** persist a solution with `hard_violations > 0` — this indicates a bug in the solver encoding.
- **Do not** silently return a partial result if all variants are infeasible — surface it as a `422` with the contradiction details.
- **Do not** trust `num_classes` from `cohort.num_classes` alone — always use the value passed in `SolveRequest.num_classes`, which the frontend has resolved from the distribution toggle.
- **Do not** label solutions by rank (Solution 1, 2, 3) — label by objective profile (`balanced_sizes`, `soft_priority`, `diversity_mix`).
- **Do not** share the same `model` or `penalty_terms` list across the 3 variants — each variant needs a fresh `cp_model.CpModel()` instance.
