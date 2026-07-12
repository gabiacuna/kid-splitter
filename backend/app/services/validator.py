from dataclasses import dataclass
from collections import defaultdict, deque
from math import ceil
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..models.constraint import BinaryConstraint


@dataclass
class Contradiction:
    type:        str
    message:     str
    student_ids: list[str]


def detect_contradictions(
    binary_constraints: list["BinaryConstraint"],
    num_classes: int,
    total_students: int,
) -> list[Contradiction]:
    contradictions: list[Contradiction] = []
    max_class_size = ceil(total_students / num_classes)

    hard = [c for c in binary_constraints if c.is_hard]
    soft = [c for c in binary_constraints if not c.is_hard]

    together_pairs: set[tuple[str, str]] = set()
    separate_pairs: set[tuple[str, str]] = set()

    for c in hard:
        pair = (min(c.student_a_id, c.student_b_id), max(c.student_a_id, c.student_b_id))
        if c.type == "together":
            together_pairs.add(pair)
        else:
            separate_pairs.add(pair)

    # Direct conflict: same pair has both together and separate hard constraints
    for pair in together_pairs & separate_pairs:
        contradictions.append(Contradiction(
            type="direct_conflict",
            message=f"Students {pair[0]} and {pair[1]} have both hard TOGETHER and hard SEPARATE constraints",
            student_ids=list(pair),
        ))

    # Cluster overflow: BFS on together graph — component > max_class_size is impossible
    adj: dict[str, set[str]] = defaultdict(set)
    for a, b in together_pairs:
        adj[a].add(b)
        adj[b].add(a)

    visited: set[str] = set()
    all_nodes = {s for pair in together_pairs for s in pair}

    for start in all_nodes:
        if start in visited:
            continue
        component: list[str] = []
        queue = deque([start])
        while queue:
            node = queue.popleft()
            if node in visited:
                continue
            visited.add(node)
            component.append(node)
            for neighbor in adj[node]:
                if neighbor not in visited:
                    queue.append(neighbor)
        if len(component) > max_class_size:
            contradictions.append(Contradiction(
                type="cluster_overflow",
                message=(
                    f"A group of {len(component)} students must stay together but "
                    f"max class size is {max_class_size}"
                ),
                student_ids=component,
            ))

    # Coloring impossible: greedy check on hard separate graph
    # If greedy coloring needs > num_classes colors, it's impossible
    sep_adj: dict[str, set[str]] = defaultdict(set)
    for a, b in separate_pairs:
        sep_adj[a].add(b)
        sep_adj[b].add(a)

    sep_nodes = list({s for pair in separate_pairs for s in pair})
    colors: dict[str, int] = {}
    for node in sorted(sep_nodes, key=lambda n: -len(sep_adj[n])):
        neighbor_colors = {colors[nb] for nb in sep_adj[node] if nb in colors}
        color = 0
        while color in neighbor_colors:
            color += 1
        colors[node] = color

    if colors and max(colors.values()) + 1 > num_classes:
        contradictions.append(Contradiction(
            type="coloring_impossible",
            message=(
                f"Hard SEPARATE constraints require at least {max(colors.values()) + 1} "
                f"classes but only {num_classes} are configured"
            ),
            student_ids=sep_nodes,
        ))

    # Soft warning: A+B soft-together, B+C soft-together, A+C soft-separate
    soft_together: set[tuple[str, str]] = set()
    soft_separate: set[tuple[str, str]] = set()
    for c in soft:
        pair = (min(c.student_a_id, c.student_b_id), max(c.student_a_id, c.student_b_id))
        if c.type == "together":
            soft_together.add(pair)
        else:
            soft_separate.add(pair)

    soft_adj: dict[str, set[str]] = defaultdict(set)
    for a, b in soft_together:
        soft_adj[a].add(b)
        soft_adj[b].add(a)

    warned: set[tuple[str, str, str]] = set()
    for a, b in soft_together:
        for c in soft_adj[a] & soft_adj[b]:
            triple = tuple(sorted([a, b, c]))
            if triple in warned:
                continue
            pair_ac = (min(a, c), max(a, c))
            pair_bc = (min(b, c), max(b, c))
            if pair_ac in soft_separate or pair_bc in soft_separate:
                warned.add(triple)
                contradictions.append(Contradiction(
                    type="soft_warning",
                    message="Conflicting soft constraints: two students prefer to be together but one prefers to be separate",
                    student_ids=list(triple),
                ))

    return contradictions
