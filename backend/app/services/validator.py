"""Pre-solve constraint checks, reported as conflict groups.

Each group names the exact rules (constraint ids) involved, so the editor can badge
those rows — and only those — with the group number. Explanations use student names,
never ids or row positions (row positions shift while the teacher edits).
"""
from collections import defaultdict
from dataclasses import dataclass, field
from math import ceil
from typing import TYPE_CHECKING, Iterable, Optional

from ortools.sat.python import cp_model

if TYPE_CHECKING:
    from ..models.constraint import BinaryConstraint

# Exact colouring is NP-hard in general but trivial at this scale (≤4 classes, ≤500
# students). If it still can't decide in time, we let the solve proceed: the real
# solver is the backstop and reports genuine infeasibility itself.
COLORING_TIME_LIMIT_S = 2.0
MAX_NAMES_IN_TEXT = 5


@dataclass
class ConflictGroup:
    id:             int          # 1-based; the badge number
    type:           str          # direct_conflict | chain_conflict | cluster_overflow | coloring_impossible | soft_warning
    severity:       str          # "hard" (blocks solving) | "soft" (advisory)
    constraint_ids: list[str]
    student_ids:    list[str]
    explanation:    str


@dataclass
class Contradiction:
    """Legacy shape, kept for one release (see docs/design-implementation/04)."""
    type:        str
    message:     str
    student_ids: list[str]


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _pair(c) -> tuple[str, str]:
    return (min(c.student_a_id, c.student_b_id), max(c.student_a_id, c.student_b_id))


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        self.parent[self.find(a)] = self.find(b)


@dataclass
class _Names:
    names: dict[str, str] = field(default_factory=dict)

    def one(self, sid: str) -> str:
        return self.names.get(sid, "a student")

    def many(self, ids: Iterable[str]) -> str:
        labels = sorted(self.one(s) for s in ids)
        if len(labels) > MAX_NAMES_IN_TEXT:
            shown = ", ".join(labels[:MAX_NAMES_IN_TEXT])
            return f"{shown} and {len(labels) - MAX_NAMES_IN_TEXT} more"
        if len(labels) <= 1:
            return "".join(labels)
        return ", ".join(labels[:-1]) + " and " + labels[-1]


def short_display_names(students: Iterable[tuple[str, str, str]]) -> dict[str, str]:
    """'Amara O.' style names; falls back to the full name where initials would collide."""
    students = list(students)
    short = {sid: f"{first} {last[:1]}.".strip() if last else first for sid, first, last in students}
    counts: dict[str, int] = defaultdict(int)
    for v in short.values():
        counts[v] += 1
    return {
        sid: (short[sid] if counts[short[sid]] == 1 else f"{first} {last}".strip())
        for sid, first, last in students
    }


def _together_path(adj: dict[str, set[str]], start: str, goal: str) -> list[str]:
    """Shortest chain of must-be-together links from start to goal (BFS)."""
    prev: dict[str, Optional[str]] = {start: None}
    queue = [start]
    while queue:
        node = queue.pop(0)
        if node == goal:
            break
        for nb in sorted(adj[node]):
            if nb not in prev:
                prev[nb] = node
                queue.append(nb)
    path, node = [], goal
    while node is not None:
        path.append(node)
        node = prev.get(node)
    return path[::-1]


def _colourable(nodes: list[str], edges: list[tuple[str, str]], k: int) -> Optional[bool]:
    """Exact k-colourability via CP-SAT. None = undecided within the time limit."""
    model = cp_model.CpModel()
    colour = {n: model.NewIntVar(0, k - 1, f"c_{i}") for i, n in enumerate(nodes)}
    for a, b in edges:
        model.Add(colour[a] != colour[b])
    if nodes:
        model.Add(colour[nodes[0]] == 0)  # symmetry breaking
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = COLORING_TIME_LIMIT_S
    solver.parameters.num_workers = 1
    status = solver.Solve(model)
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return True
    if status == cp_model.INFEASIBLE:
        return False
    return None


# ---------------------------------------------------------------------------
# detection
# ---------------------------------------------------------------------------

def detect_conflicts(
    binary_constraints: list["BinaryConstraint"],
    num_classes: int,
    total_students: int,
    names: Optional[dict[str, str]] = None,
) -> list[ConflictGroup]:
    n = _Names(names or {})
    hard_groups: list[tuple[str, list[str], list[str], str]] = []  # (type, cids, sids, text)
    soft_groups: list[tuple[str, list[str], list[str], str]] = []
    max_class_size = ceil(total_students / num_classes) if num_classes else 0

    hard = [c for c in binary_constraints if c.is_hard]
    soft = [c for c in binary_constraints if not c.is_hard]

    hard_together: dict[tuple[str, str], list] = defaultdict(list)
    hard_separate: dict[tuple[str, str], list] = defaultdict(list)
    for c in hard:
        (hard_together if c.type == "together" else hard_separate)[_pair(c)].append(c)

    # 1. Direct conflict: the same pair must be both together and apart.
    direct_pairs = set(hard_together) & set(hard_separate)
    for pair in sorted(direct_pairs):
        a, b = pair
        cids = [c.id for c in hard_together[pair] + hard_separate[pair]]
        hard_groups.append((
            "direct_conflict", cids, [a, b],
            f"{n.one(a)} and {n.one(b)} must be together, but must also be apart. Remove one of these two rules.",
        ))

    # Together clusters (hard).
    uf = _UnionFind()
    adj: dict[str, set[str]] = defaultdict(set)
    for a, b in hard_together:
        uf.union(a, b)
        adj[a].add(b)
        adj[b].add(a)
    clusters: dict[str, set[str]] = defaultdict(set)
    for s in list(adj):
        clusters[uf.find(s)].add(s)

    def together_ids_in(members: set[str]) -> list[str]:
        return [c.id for p, cs in hard_together.items() if p[0] in members for c in cs]

    # 2. Cluster overflow: more students chained together than fit in one class.
    for members in clusters.values():
        if max_class_size and len(members) > max_class_size:
            hard_groups.append((
                "cluster_overflow", together_ids_in(members), sorted(members),
                f"{len(members)} students are linked by “must be together” rules "
                f"({n.many(members)}), but a class holds at most {max_class_size}. "
                f"Remove one of these rules or add a class.",
            ))

    # 3. Chain conflict: must be apart, but linked by a chain of must-be-together rules.
    contracted_edges: dict[tuple[str, str], list] = defaultdict(list)
    for pair, cs in hard_separate.items():
        if pair in direct_pairs:
            continue  # already reported, don't double-badge
        a, b = pair
        ra, rb = uf.find(a), uf.find(b)
        if ra == rb and a in adj and b in adj:
            path = _together_path(adj, a, b)
            chain_ids = [
                c.id for x, y in zip(path, path[1:])
                for c in hard_together[(min(x, y), max(x, y))]
            ]
            hard_groups.append((
                "chain_conflict", [c.id for c in cs] + chain_ids, path,
                f"{n.one(a)} and {n.one(b)} must be apart, but “must be together” rules link them "
                f"({' → '.join(n.one(s) for s in path)}), so they would land in the same class. "
                f"Remove one of these rules.",
            ))
        else:
            contracted_edges[(min(ra, rb), max(ra, rb))].extend(cs)

    # 4. Colouring: can the must-be-apart graph (over together-clusters) fit in num_classes?
    #    Exact, per connected component. Greedy colouring over-reports and used to block
    #    solvable cohorts.
    comp_uf = _UnionFind()
    for a, b in contracted_edges:
        comp_uf.union(a, b)
    components: dict[str, set[str]] = defaultdict(set)
    for a, b in contracted_edges:
        components[comp_uf.find(a)].update((a, b))
    for nodes in components.values():
        if len(nodes) <= num_classes:
            continue
        edges = [e for e in contracted_edges if e[0] in nodes]
        if _colourable(sorted(nodes), edges, num_classes) is not False:
            continue  # colourable, or undecided -> don't block
        sep_ids = [c.id for e in edges for c in contracted_edges[e]]
        students = {s for e in edges for c in contracted_edges[e] for s in (c.student_a_id, c.student_b_id)}
        merged = {root for root in nodes if len(clusters.get(root, ())) > 1}
        tog_ids = [cid for root in merged for cid in together_ids_in(clusters[root])]
        hard_groups.append((
            "coloring_impossible", sep_ids + tog_ids, sorted(students),
            f"These {len(sep_ids)} “must be apart” rules (between {n.many(students)}) together need more than "
            f"{num_classes} classes, and you have {num_classes}. No single rule is to blame: "
            f"add a class, or remove one of these rules.",
        ))

    # 5. Soft warning: A~B and B~C prefer together, but A~C prefers apart.
    soft_together: dict[tuple[str, str], list] = defaultdict(list)
    soft_separate: dict[tuple[str, str], list] = defaultdict(list)
    for c in soft:
        (soft_together if c.type == "together" else soft_separate)[_pair(c)].append(c)
    s_adj: dict[str, set[str]] = defaultdict(set)
    for a, b in soft_together:
        s_adj[a].add(b)
        s_adj[b].add(a)
    seen: set[tuple[str, str, str]] = set()
    for a, b in sorted(soft_together):
        for mid, x in ((a, b), (b, a)):
            for other in sorted(s_adj[mid] - {x}):
                apart = (min(x, other), max(x, other))
                if apart not in soft_separate:
                    continue
                triple = tuple(sorted((x, mid, other)))
                if triple in seen:
                    continue
                seen.add(triple)
                cids = [c.id for p in ((min(x, mid), max(x, mid)), (min(mid, other), max(mid, other)))
                        for c in soft_together[p]] + [c.id for c in soft_separate[apart]]
                soft_groups.append((
                    "soft_warning", cids, list(triple),
                    f"{n.one(x)} and {n.one(mid)} prefer to be together, and so do {n.one(mid)} and "
                    f"{n.one(other)}, but {n.one(x)} and {n.one(other)} prefer to be apart. "
                    f"The solver will have to break one of these preferences.",
                ))

    groups: list[ConflictGroup] = []
    for severity, items in (("hard", hard_groups), ("soft", soft_groups)):
        for type_, cids, sids, text in items:
            groups.append(ConflictGroup(
                id=len(groups) + 1, type=type_, severity=severity,
                constraint_ids=list(dict.fromkeys(cids)), student_ids=list(dict.fromkeys(sids)),
                explanation=text,
            ))
    return groups


def detect_contradictions(
    binary_constraints: list["BinaryConstraint"],
    num_classes: int,
    total_students: int,
    names: Optional[dict[str, str]] = None,
) -> list[Contradiction]:
    """Legacy wrapper over detect_conflicts (callers filter on type != 'soft_warning')."""
    return [
        Contradiction(type=g.type, message=g.explanation, student_ids=g.student_ids)
        for g in detect_conflicts(binary_constraints, num_classes, total_students, names)
    ]
