# Feature: Constraint Editor (Binary · Unary · Hard/Soft · Contradiction Warnings)

> Agent context: Constraints come in two kinds. Binary constraints relate two students (together/separate). Unary constraints apply to one student's class environment (small class, max flagged peers, etc.). Each constraint can be hard (never violate) or soft (penalize if violated, with a weight). The solve button must be disabled if any contradictions exist.

---

## Goal

Let teachers define placement rules for individual students or pairs. Surface contradiction warnings inline so teachers resolve them before attempting a solve.

---

## Components

### `ConstraintEditorPage` (`src/pages/ConstraintEditorPage.tsx`)

Route: `/cohorts/:id/constraints` (also rendered as the Constraints tab on `CohortDetailPage`)

**Layout:**
- Section heading: "Binary constraints" + "Add binary" button
- List of `ConstraintRow` components (binary)
- Section heading: "Unary constraints" + "Add unary" button
- List of `ConstraintRow` components (unary)
- Contradiction warning panel (shown if any contradictions exist — see below)
- "Validate" button triggers manual re-validation (auto-validates on any change too)

---

### `ConstraintRow` (`src/components/ConstraintRow.tsx`)

One row per constraint. Binary and unary rows share this component with slightly different field sets.

**Props:**
```ts
interface ConstraintRowProps {
  constraint: BinaryConstraint | UnaryConstraint;
  students: Student[];   // for the student selector dropdowns
  onChange: (updated: BinaryConstraint | UnaryConstraint) => void;
  onDelete: (id: string) => void;
}

interface BinaryConstraint {
  id: string;
  student_a_id: string;
  student_b_id: string;
  type: 'together' | 'separate';
  is_hard: boolean;
  weight: number;   // 0.1–10.0; ignored when is_hard = true
  notes?: string;
}

interface UnaryConstraint {
  id: string;
  student_id: string;
  type: 'small_class' | 'large_class' | 'max_flagged_peers' | 'max_conflict_peers';
  parameter?: number;   // required for max_* types
  is_hard: boolean;
  weight: number;
  notes?: string;
}
```

**Binary row fields (in order):**
1. Student A selector (searchable dropdown, shows "First Last")
2. Constraint type dropdown: `Together` / `Separate`
3. Student B selector (searchable dropdown)
4. Hard constraint checkbox: "Hard — never violate"
5. Weight slider (1–5 stepped, labeled "Low" → "High") — **hidden when `is_hard = true`**
6. Notes field (single-line text, optional, collapsed by default — show "Add note" link)
7. Delete button (icon or text)

**Unary row fields (in order):**
1. Student selector
2. Constraint type dropdown: `Small class` / `Large class` / `Max flagged peers` / `Max conflict peers`
3. Parameter input (number) — **shown only for `max_flagged_peers` and `max_conflict_peers`**; label: "Max [N] in same class"
4. Hard constraint checkbox
5. Weight slider (hidden when `is_hard = true`)
6. Notes (same as binary)
7. Delete button

**Row states:**

| State | Behavior |
|---|---|
| Unsaved new row | Row has a "Save" button; other rows are not affected |
| Saving | "Save" → "Saving…", row disabled |
| Saved | Row returns to display mode; auto-validate runs |
| Save error | "Failed to save. Try again." inline |
| Deleting | Confirmation: "Remove this constraint?" (inline, not a modal) |
| Delete error | "Failed to delete. Try again." |

**Auto-save vs explicit save:** Use explicit save per row (not auto-save on blur) — constraints are meaningful rules and teachers should confirm each one intentionally.

---

### `ContradictionPanel` (`src/components/ContradictionPanel.tsx`)

Shown above the solve button (or at the top of the Constraints tab) whenever `GET /cohorts/{id}/constraints/validate` returns contradictions.

**Props:**
```ts
interface ContradictionPanelProps {
  contradictions: Contradiction[];
}

interface Contradiction {
  type: 'hard_conflict' | 'cluster_too_large' | 'separation_impossible';
  message: string;         // human-readable from the API
  student_ids: string[];   // to highlight affected rows
}
```

**Display:**
- Warning banner: "Solve disabled — [N] contradiction(s) found"
- List each contradiction as a plain sentence (use the `message` field from the API)
- Highlight the affected `ConstraintRow` components with a red/amber border

**When panel is hidden:** Zero contradictions, or no constraints exist yet.

---

### `AddConstraintButton`

Adds a new blank row to the appropriate section (binary or unary). The new row is in "unsaved new" state immediately.

**New binary row defaults:** student A = empty, type = `together`, is_hard = false, weight = 1.0
**New unary row defaults:** student = empty, type = `small_class`, is_hard = false, weight = 1.0

---

## Validation Trigger

Auto-validate (call `GET /cohorts/{id}/constraints/validate`) after:
- Any constraint is saved
- Any constraint is deleted

Also expose a manual "Validate now" button for teachers who want to check before saving a new row.

The solve button (in `05-solve-configuration.md`) reads from the contradiction state — disable it if `contradictions.length > 0`.

---

## API Calls

| Action | Method + Path | Request body | Success | Error |
|---|---|---|---|---|
| List all constraints | `GET /cohorts/{id}/constraints` | — | 200 + `{ binary: [], unary: [] }` | Error state |
| Add binary constraint | `POST /cohorts/{id}/constraints/binary` | `BinaryConstraint` (no id) | 201 + saved constraint | 422 validation |
| Add unary constraint | `POST /cohorts/{id}/constraints/unary` | `UnaryConstraint` (no id) | 201 + saved constraint | 422 |
| Update binary | `PUT /constraints/binary/{id}` | Partial `BinaryConstraint` | 200 + updated | 422 |
| Update unary | `PUT /constraints/unary/{id}` | Partial `UnaryConstraint` | 200 + updated | 422 |
| Delete binary | `DELETE /constraints/binary/{id}` | — | 204 | Toast error |
| Delete unary | `DELETE /constraints/unary/{id}` | — | 204 | Toast error |
| Validate | `GET /cohorts/{id}/constraints/validate` | — | 200 + `Contradiction[]` | Show stale warning if fails |

---

## Edge Cases

| Case | Handling |
|---|---|
| Teacher selects the same student for both A and B in a binary constraint | Block at row level before save: "Select two different students." |
| Teacher sets `parameter` for `max_flagged_peers` to 0 | Allow — valid rule meaning "no flagged peers in same class" |
| Constraint saved, then one of its students is deleted | Backend cascades. On next page load, the constraint row will be gone. If teacher is on the page when it happens: the row may show a missing student — refresh handles it. |
| Cohort has no students yet | Student selectors are empty. Show a banner: "Add students before creating constraints." Disable "Add constraint" buttons. |
| Soft warning contradiction (A+B together, B+C together, A+C separate) | Show as a warning (not blocking) in the panel: "This combination may result in soft constraint violations. The solver will handle it." Solve button remains enabled. |
| Weight slider when `is_hard` is toggled on | Immediately hide slider; weight value is preserved in state for if teacher toggles back to soft |

---

## Done When

- [ ] Binary constraints render with both student selectors, type dropdown, hard checkbox, weight slider
- [ ] Unary constraints render with student selector, type dropdown, parameter field (for max_* types only), hard checkbox, weight slider
- [ ] Weight slider is hidden when `is_hard` is checked
- [ ] Saving a constraint calls the correct POST or PUT endpoint
- [ ] Contradiction panel appears when API returns contradictions
- [ ] Affected constraint rows are visually highlighted when a contradiction is detected
- [ ] Solve button is disabled when contradictions exist (coordinated with `05-solve-configuration.md`)
- [ ] Deleting a constraint requires inline confirmation and re-runs validation
- [ ] Constraints section shows a banner and disables add buttons when cohort has no students
