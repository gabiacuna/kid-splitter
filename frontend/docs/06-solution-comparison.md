# Feature: Solution Comparison (3-Card View · Diff Indicators · Select)

> Agent context: Each solve run produces 2–3 solution variants with different objective profiles: `balanced_sizes`, `soft_priority`, and `diversity_mix`. The teacher sees all variants side-by-side and picks one to inspect in detail. Solutions with hard violations must be clearly flagged — they indicate a bug and should not normally occur.

---

## Goal

Show the teacher all solution variants from a solve run in a scannable side-by-side layout. Highlight meaningful differences between variants. Let the teacher navigate into any solution for the full roster view.

---

## Components

### `SolutionListPage` (Solutions tab on `CohortDetailPage`)

Route: Rendered as the Solutions tab at `/cohorts/:id?tab=solutions`

**Layout:**
- If no solutions: "No class lists yet. Go to Solve to generate options."
- If solutions exist: group by solve run (each run is a set of 2–3 cards created at the same time)
- Within each group: show cards side-by-side (row on desktop, stacked on mobile)
- Show solve timestamp as group header: "Generated on [date at time]"
- Show a "FEASIBLE (not optimal)" badge on the group header if any solution in the run has that status in `solver_metadata`

---

### `SolutionCard` (`src/components/SolutionCard.tsx`)

**Props:**
```ts
interface SolutionCardProps {
  solution: Solution;
  allSolutions: Solution[];  // the other cards in the same run, for diff computation
  onSelect: (id: string) => void;
}

interface Solution {
  id: string;
  label: string;               // e.g. "Balanced sizes"
  score: number;               // lower = better
  hard_violations: number;     // must be 0
  soft_violations: number;
  solver_metadata: {
    status: 'OPTIMAL' | 'FEASIBLE';
    wall_time_seconds: number;
  };
  class_assignments: ClassAssignment[];
}

interface ClassAssignment {
  student_id: string;
  class_number: number;
}
```

**Card content (top to bottom):**

1. **Label** — e.g. "Balanced sizes" (styled as a card title)
2. **Score** — "Score: 4.2" with a note "(lower is better)" on first card only
3. **Hard violations badge** — only shown if `hard_violations > 0`; red badge: "⚠ [N] hard violation(s) — this solution has a problem"
4. **Soft violations** — "[N] soft constraint(s) not fully met"
5. **Class size distribution** — small horizontal bar chart (one bar per class, bar width proportional to class size). Label each bar with the count.
6. **Diff indicators** — list of changed constraints vs. the reference card (see Diff Indicators below)
7. **"View class lists"** button → navigates to `/solutions/:id`

**Card visual states:**

| State | Behavior |
|---|---|
| Normal | Standard card styling |
| Has hard violations | Red left border or red header band; hard violation badge prominent |
| Best score in run | Subtle "Best" badge in the top-right corner |

---

### Diff Indicators

Show which soft constraints changed satisfaction status between this solution and the reference solution (the first card in the group, or the `soft_priority` variant if present).

**What to diff:**
The backend returns assignments; the frontend computes which constraints are satisfied.

A binary constraint is satisfied if:
- `together`: both students share the same `class_number`
- `separate`: students have different `class_number`

A constraint's satisfaction status: `satisfied | violated`.

**Diff display (per card, except the reference card):**
- "2 constraints now satisfied ↑" (green)
- "1 constraint now violated ↓" (red)

On hover/click, expand to list the specific constraints by their student names and type.

**If all constraints have identical satisfaction across cards:** show "No difference in constraint satisfaction."

**Computation:** do this client-side after receiving all assignments. Do not add a backend endpoint for this.

---

### `SizeDistributionChart` (`src/components/SizeDistributionChart.tsx`)

Inline horizontal bar chart showing class sizes within a solution card.

**Props:**
```ts
interface SizeDistributionChartProps {
  assignments: ClassAssignment[];
  numClasses: number;
}
```

Compute class sizes from `assignments` client-side. Render as small horizontal bars (SVG or CSS-only, no charting library needed for this). Label each bar: "Class 1: 15".

---

## API Calls

| Action | Method + Path | Success | Error |
|---|---|---|---|
| List solutions for cohort | `GET /cohorts/{id}/solutions` | 200 + `Solution[]` with assignments included | Error state with retry |
| Delete a solution | `DELETE /solutions/{id}` | 204 | Toast: "Failed to delete solution." |

If `GET /cohorts/{id}/solutions` does not include assignments, fetch `GET /solutions/{id}` for each card to get full assignment data needed for the diff. Prefer including assignments in the list response to avoid N+1 requests.

---

## Edge Cases

| Case | Handling |
|---|---|
| Only 2 solutions returned (solver couldn't differentiate 3) | Show 2 cards; no special messaging needed |
| All 3 solutions have the same score | All valid; show all with no "Best" badge (or badge all three) |
| `hard_violations > 0` on any solution | Show red badge and border; do NOT suppress or hide the solution. This is a bug signal. |
| Solution deleted, only 1 remains | Show 1 card; no comparison possible. Remove diff indicators. |
| All solutions deleted | Show empty state: "No class lists yet." |
| Solve run has `FEASIBLE` status | Show note on the group header: "Solver reached time limit — results may not be optimal." |
| Teacher has multiple solve runs for the same cohort | Group by run (same `created_at` timestamp cluster). Show most recent run first. |

---

## Done When

- [ ] Solutions from the same run are grouped and shown side-by-side
- [ ] Each card shows label, score, hard violations (if any), soft violations, class size distribution
- [ ] Hard violation cards have a prominent red visual treatment
- [ ] The best-score card has a "Best" badge
- [ ] Diff indicators show how many constraints changed satisfaction vs. the reference card
- [ ] Diff expands to show specific constraint details on hover/click
- [ ] Class size distribution renders as a bar chart with class counts
- [ ] "View class lists" navigates to the solution detail page
- [ ] FEASIBLE status on a run is shown as a group-level banner
- [ ] Deleting a solution removes it from the view
