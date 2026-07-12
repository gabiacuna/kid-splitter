# Feature: Solve Configuration (Distribution Toggle · Resolve num_classes · Trigger Solve)

> Agent context: Before running the solver, the teacher must confirm how many classes to create. This can be set as a direct count ("3 classes") or inferred from a target class size ("18 students per class → 3 classes"). The resolved `num_classes` is always what gets sent to the API. The solve button must be disabled if contradictions exist. Solving is slow (up to ~8s) — handle that visibly.

---

## Goal

Let the teacher configure the class distribution, see the resolved number of classes before committing, and trigger the solver. On completion, navigate to the solution comparison view.

---

## Components

### `SolveConfigPage` (`src/pages/SolveConfigPage.tsx`)

Route: `/cohorts/:id/solve`

Also accessible as a panel within the cohort detail — your call on whether this is a full page or a modal triggered from the Solutions tab.

---

### `DistributionToggle` (`src/components/DistributionToggle.tsx`)

A segmented control with two modes. Only one mode is active at a time.

**Props:**
```ts
interface DistributionToggleProps {
  totalStudents: number;
  value: DistributionConfig;
  onChange: (config: DistributionConfig) => void;
}

type DistributionConfig =
  | { mode: 'num_classes'; num_classes: number }
  | { mode: 'target_size'; target_size: number };
```

**Mode A — "Number of classes":**
- Label: "Split into [input] classes"
- Input: number, min 2, max 20
- Resolved display: just the number entered

**Mode B — "Target class size":**
- Label: "Target [input] students per class"
- Input: number, min 2, max 200
- Resolved display: show inline → "→ [N] classes" computed as `Math.ceil(totalStudents / target_size)`

**Switching modes:**
- Switching clears the other mode's input value
- The previously active input does not persist across mode switches

**Resolved `num_classes` display:**
Always show a resolved summary line below the toggle before the solve button:

```
→ 45 students will be split into 3 classes (15 students each)
```

If the distribution is uneven:
```
→ 46 students will be split into 3 classes (16 / 15 / 15)
```

This line is computed client-side. It is not fetched from the API.

---

### `SolveButton` (`src/components/SolveButton.tsx`)

**Props:**
```ts
interface SolveButtonProps {
  cohortId: string;
  numClasses: number;
  hasContradictions: boolean;
  onSuccess: (solutions: Solution[]) => void;
}
```

**States:**

| State | Behavior |
|---|---|
| Disabled — contradictions | Button greyed out; tooltip or inline note: "Resolve constraint contradictions before solving." |
| Disabled — no students | Button greyed out; inline: "Add students before solving." |
| Disabled — num_classes not set | Button greyed out; inline: "Set the number of classes above." |
| Ready | Button: "Generate class lists" |
| Solving | Button: "Solving…", disabled. Show a progress note: "This may take up to 8 seconds." |
| Success | Call `onSuccess(solutions)` → navigate to `/cohorts/:id` Solutions tab |
| Error — INFEASIBLE | Show error panel: "No valid arrangement exists with these constraints. Check for conflicting hard constraints." List conflicting constraint IDs if returned by API. |
| Error — server | "Solve failed. Try again." |

**Solve progress UX:**
- Do not use a progress bar (solve time is not predictable)
- Show elapsed seconds: "Solving… (3s)" updating every second
- If response takes > 8s, show: "Taking longer than expected…" (this shouldn't normally happen given the server-side time limit)

---

## API Calls

| Action | Method + Path | Request body | Success | Error |
|---|---|---|---|---|
| Trigger solve | `POST /cohorts/{id}/solve` | `{ "num_classes": N }` | 200 + `Solution[]` (2–3 solutions) | 422 validation, 409 INFEASIBLE |

The solve endpoint is synchronous — the server blocks until the solver finishes (max 8s). Handle this with a generous client-side timeout (15s) before showing a "Taking longer than expected" message.

---

## Computed Values (client-side only)

```ts
function resolveNumClasses(config: DistributionConfig, totalStudents: number): number {
  if (config.mode === 'num_classes') return config.num_classes;
  return Math.ceil(totalStudents / config.target_size);
}

function classDistributionSummary(totalStudents: number, numClasses: number): string {
  const base = Math.floor(totalStudents / numClasses);
  const remainder = totalStudents % numClasses;
  if (remainder === 0) return `${numClasses} classes (${base} students each)`;
  const sizes = [
    ...Array(remainder).fill(base + 1),
    ...Array(numClasses - remainder).fill(base),
  ];
  return `${numClasses} classes (${sizes.join(' / ')})`;
}
```

---

## Edge Cases

| Case | Handling |
|---|---|
| `num_classes >= total_students` | Client-side: disable solve button, show: "Number of classes cannot exceed number of students ([N])." |
| `num_classes = 1` | Client-side: disable solve button, show: "Minimum 2 classes." |
| `target_size` so large it resolves to 1 class | Same as above — resolved `num_classes` is checked, not the input mode |
| Solve triggered, teacher navigates away | Solve continues server-side. On return to Solutions tab, the new solutions will appear on refresh. No client-side cancel mechanism needed at MVP. |
| Solver returns FEASIBLE (not OPTIMAL) status | Show a subtle note on the resulting solutions: "Solver reached the time limit — these are the best arrangements found, but may not be perfect." |
| `num_classes` was changed since last solve | Show banner: "Class count changed since the last solve. Previous solutions used a different configuration." |
| Cohort has 0 students | Disable solve button; show: "Add students before solving." |

---

## Done When

- [ ] Distribution toggle switches between "number of classes" and "target class size" modes cleanly
- [ ] Switching modes clears the other input
- [ ] Resolved class count and distribution summary are shown below the toggle
- [ ] Solve button is disabled with explanatory text when: contradictions exist, no students, num_classes not valid
- [ ] Solve button shows elapsed time while solving
- [ ] Successful solve navigates to the Solutions tab with new solutions loaded
- [ ] INFEASIBLE response shows a clear error with guidance (not a generic error message)
- [ ] `num_classes >= total_students` is caught client-side before the API call
