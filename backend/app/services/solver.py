import logging
from dataclasses import dataclass
from math import ceil
from typing import Optional

from ortools.sat.python import cp_model

logger = logging.getLogger(__name__)

WEIGHT_SCALE = 100
DIVERSITY_WEIGHT = 50


def scale(weight: float) -> int:
    return max(1, round(weight * WEIGHT_SCALE))


@dataclass
class SolverInput:
    student_ids:        list[str]
    tags_map:           dict[str, list[str]]
    binary_constraints: list  # BinaryConstraint ORM rows
    unary_constraints:  list  # UnaryConstraint ORM rows
    num_classes:        int


@dataclass
class SolverResult:
    label:            str
    status:           str
    objective_value:  Optional[int]
    wall_time_s:      float
    assignments:      list[dict]  # [{"student_id": str, "class_number": int}]
    feasible:         bool
    soft_violations:  int = 0


def _add_soft_together(model, x, a, b, weight, num_classes, penalty_terms):
    in_same_k = []
    for k in range(num_classes):
        both_in_k = model.NewBoolVar(f"both_{a}_{b}_{k}")
        model.AddBoolAnd([x[a, k], x[b, k]]).OnlyEnforceIf(both_in_k)
        model.AddBoolOr([x[a, k].Not(), x[b, k].Not()]).OnlyEnforceIf(both_in_k.Not())
        in_same_k.append(both_in_k)

    same_class = model.NewBoolVar(f"same_{a}_{b}")
    model.AddBoolOr(in_same_k).OnlyEnforceIf(same_class)
    model.AddBoolAnd([v.Not() for v in in_same_k]).OnlyEnforceIf(same_class.Not())
    penalty_terms.append(scale(weight) * same_class.Not())


def _add_soft_separate(model, x, a, b, weight, num_classes, penalty_terms):
    in_same_k = []
    for k in range(num_classes):
        both_in_k = model.NewBoolVar(f"both_{a}_{b}_{k}")
        model.AddBoolAnd([x[a, k], x[b, k]]).OnlyEnforceIf(both_in_k)
        model.AddBoolOr([x[a, k].Not(), x[b, k].Not()]).OnlyEnforceIf(both_in_k.Not())
        in_same_k.append(both_in_k)

    together = model.NewBoolVar(f"together_{a}_{b}")
    model.AddBoolOr(in_same_k).OnlyEnforceIf(together)
    model.AddBoolAnd([v.Not() for v in in_same_k]).OnlyEnforceIf(together.Not())
    penalty_terms.append(scale(weight) * together)


def _build_model(inp: SolverInput, include_soft: bool, include_diversity: bool) -> tuple:
    model = cp_model.CpModel()
    student_ids = inp.student_ids
    num_classes = inp.num_classes
    total = len(student_ids)

    x = {}
    for s in student_ids:
        for k in range(num_classes):
            x[s, k] = model.NewBoolVar(f"x_{s}_{k}")

    for s in student_ids:
        model.AddExactlyOne(x[s, k] for k in range(num_classes))

    min_size = total // num_classes
    max_size = ceil(total / num_classes)
    for k in range(num_classes):
        model.Add(sum(x[s, k] for s in student_ids) >= min_size)
        model.Add(sum(x[s, k] for s in student_ids) <= max_size)

    penalty_terms = []

    # Size variance penalty for balanced_sizes variant
    if not include_soft and not include_diversity:
        # Minimize size variance: penalize deviation from avg
        avg = total // num_classes
        for k in range(num_classes):
            class_size = model.NewIntVar(0, total, f"size_{k}")
            model.Add(class_size == sum(x[s, k] for s in student_ids))
            above = model.NewIntVar(0, total, f"above_{k}")
            below = model.NewIntVar(0, total, f"below_{k}")
            model.Add(class_size - avg == above - below)
            model.Add(above >= 0)
            model.Add(below >= 0)
            penalty_terms.append(above)
            penalty_terms.append(below)

    for c in inp.binary_constraints:
        a, b = c.student_a_id, c.student_b_id
        if c.is_hard:
            if c.type == "together":
                for k in range(num_classes):
                    model.Add(x[a, k] == x[b, k])
            else:
                for k in range(num_classes):
                    model.Add(x[a, k] + x[b, k] <= 1)
        elif include_soft:
            if c.type == "together":
                _add_soft_together(model, x, a, b, c.weight, num_classes, penalty_terms)
            else:
                _add_soft_separate(model, x, a, b, c.weight, num_classes, penalty_terms)

    if include_soft:
        for c in inp.unary_constraints:
            s = c.student_id
            if c.type == "small_class":
                for k in range(num_classes):
                    class_size = model.NewIntVar(0, total, f"sz_{k}_{s}")
                    model.Add(class_size == sum(x[st, k] for st in student_ids))
                    too_large = model.NewBoolVar(f"tl_{s}_{k}")
                    model.Add(class_size > min_size).OnlyEnforceIf(too_large)
                    model.Add(class_size <= min_size).OnlyEnforceIf(too_large.Not())
                    both = model.NewBoolVar(f"sl_both_{s}_{k}")
                    model.AddBoolAnd([x[s, k], too_large]).OnlyEnforceIf(both)
                    model.AddBoolOr([x[s, k].Not(), too_large.Not()]).OnlyEnforceIf(both.Not())
                    if c.is_hard:
                        model.Add(too_large == 0).OnlyEnforceIf(x[s, k])
                    else:
                        penalty_terms.append(scale(c.weight) * both)

            elif c.type == "large_class":
                for k in range(num_classes):
                    class_size = model.NewIntVar(0, total, f"sz_{k}_{s}")
                    model.Add(class_size == sum(x[st, k] for st in student_ids))
                    too_small = model.NewBoolVar(f"ts_{s}_{k}")
                    model.Add(class_size < max_size).OnlyEnforceIf(too_small)
                    model.Add(class_size >= max_size).OnlyEnforceIf(too_small.Not())
                    both = model.NewBoolVar(f"lc_both_{s}_{k}")
                    model.AddBoolAnd([x[s, k], too_small]).OnlyEnforceIf(both)
                    model.AddBoolOr([x[s, k].Not(), too_small.Not()]).OnlyEnforceIf(both.Not())
                    if c.is_hard:
                        model.Add(too_small == 0).OnlyEnforceIf(x[s, k])
                    else:
                        penalty_terms.append(scale(c.weight) * both)

            elif c.type in ("max_flagged_peers", "max_conflict_peers"):
                tag = c.tag
                flagged = [
                    st for st in student_ids
                    if tag in inp.tags_map.get(st, []) and st != s
                ]
                param = c.parameter or 0
                for k in range(num_classes):
                    peer_count_in_k = sum(x[st, k] for st in flagged)
                    if c.is_hard:
                        model.Add(peer_count_in_k <= param).OnlyEnforceIf(x[s, k])
                    else:
                        excess = model.NewIntVar(0, len(flagged), f"exc_{s}_{k}")
                        model.AddMaxEquality(excess, [peer_count_in_k - param, model.NewConstant(0)])
                        in_k = x[s, k]
                        excess_here = model.NewIntVar(0, len(flagged), f"exh_{s}_{k}")
                        model.Add(excess_here == excess).OnlyEnforceIf(in_k)
                        model.Add(excess_here == 0).OnlyEnforceIf(in_k.Not())
                        penalty_terms.append(scale(c.weight) * excess_here)

    if include_diversity:
        all_tags: set[str] = set()
        for tags in inp.tags_map.values():
            all_tags.update(tags)
        for tag in all_tags:
            tagged = [s for s in student_ids if tag in inp.tags_map.get(s, [])]
            if not tagged:
                continue
            avg_per_class = len(tagged) / num_classes
            for k in range(num_classes):
                count_in_k = sum(x[s, k] for s in tagged)
                excess = model.NewIntVar(0, len(tagged), f"div_{tag}_{k}")
                model.AddMaxEquality(excess, [count_in_k - int(avg_per_class), model.NewConstant(0)])
                penalty_terms.append(DIVERSITY_WEIGHT * excess)

    if penalty_terms:
        model.Minimize(sum(penalty_terms))

    return model, x


def _count_soft_violations(assignments: list[dict], inp: SolverInput) -> int:
    assign = {a["student_id"]: a["class_number"] for a in assignments}
    class_members: dict[int, list[str]] = {}
    for sid, cls in assign.items():
        class_members.setdefault(cls, []).append(sid)

    total = len(inp.student_ids)
    min_size = total // inp.num_classes
    max_size = ceil(total / inp.num_classes)
    violations = 0

    for c in inp.binary_constraints:
        if c.is_hard:
            continue
        a_cls = assign.get(c.student_a_id)
        b_cls = assign.get(c.student_b_id)
        if a_cls is None or b_cls is None:
            continue
        same = a_cls == b_cls
        if c.type == "together" and not same:
            violations += 1
        elif c.type == "separate" and same:
            violations += 1

    for c in inp.unary_constraints:
        if c.is_hard:
            continue
        k = assign.get(c.student_id)
        if k is None:
            continue
        members = class_members.get(k, [])
        size = len(members)
        if c.type == "small_class" and size > min_size:
            violations += 1
        elif c.type == "large_class" and size < max_size:
            violations += 1
        elif c.type in ("max_flagged_peers", "max_conflict_peers"):
            tag = c.tag
            count = sum(
                1 for st in members
                if st != c.student_id and tag in inp.tags_map.get(st, [])
            )
            if count > (c.parameter or 0):
                violations += 1

    return violations


def _run_variant(label: str, inp: SolverInput, include_soft: bool, include_diversity: bool) -> SolverResult:
    model, x = _build_model(inp, include_soft, include_diversity)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 8.0
    status = solver.Solve(model)

    STATUS_MAP = {
        cp_model.OPTIMAL:    "OPTIMAL",
        cp_model.FEASIBLE:   "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.UNKNOWN:    "UNKNOWN",
    }

    status_str = STATUS_MAP.get(status, "UNKNOWN")
    feasible = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    assignments = []
    if feasible:
        for s in inp.student_ids:
            for k in range(inp.num_classes):
                if solver.Value(x[s, k]) == 1:
                    assignments.append({"student_id": s, "class_number": k + 1})
                    break

    obj = int(solver.ObjectiveValue()) if feasible else None
    soft_violations = _count_soft_violations(assignments, inp) if feasible else 0

    return SolverResult(
        label=label,
        status=status_str,
        objective_value=obj,
        wall_time_s=solver.WallTime(),
        assignments=assignments,
        feasible=feasible,
        soft_violations=soft_violations,
    )


def run_solver(inp: SolverInput) -> list[SolverResult]:
    variants = [
        ("balanced_sizes", False, False),
        ("soft_priority",  True,  False),
        ("diversity_mix",  True,  True),
    ]
    results = []
    for label, include_soft, include_diversity in variants:
        try:
            result = _run_variant(label, inp, include_soft, include_diversity)
            results.append(result)
        except Exception:
            logger.exception("Solver variant %s failed", label)
    return results
