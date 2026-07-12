# Feature: Solution Detail (Full Roster · Constraint Summary · Manual Override)

> Agent context: The solution detail page shows the full class assignment for one solution variant. Students are grouped by class. Constraint satisfaction is shown per constraint. In Phase 5, teachers can manually move a student to a different class and see an updated score without re-running the solver.

---

## Goal

Let the teacher review the full class roster for one solution, understand which constraints were satisfied or violated, and (Phase 5) manually adjust one student's assignment.

---

## Components

### `SolutionDetailPage` (`src/pages/SolutionDetailPage.tsx`)

Route: `/solutions/:id`

**Page header:**
- Solution label (e.g. "Soft priority")
- Score: "Score: 4.2 (lower is better)"
- Hard violations badge (red, if any — same treatment as in `SolutionCard`)
- "Back to class lists" link → `/cohorts/:id?tab=solutions`
- Share button → opens `ShareModal` (see `08-share.md`)

---

### `ClassRosterList` (`src/components/ClassRosterList.tsx`)

**Props:**
```ts
interface ClassRosterListProps {
  assignments: StudentAssignment[];
  students: Student[];  // full student objects for name lookup
  numClasses: number;
  onMoveStudent?: (studentId: string, toClass: number) => void; // Phase 5 only
}

interface StudentAssignment {
  student_id: string;
  class_number: number;
}
```

**Layout:** One section per class, stacked vertically (or side-by-side in a grid on wide screens).

**Per class section:**
- Heading: "Class [N]" + student count badge: "([N] students)"
- Alphabetical list of students: "First Last" + their tags as small pills
- Class size shown visually (e.g. a subtle bar or just the count)

**Student name display:** Always show first + last name on this page (teacher-only view). Last name is only hidden on the public share page.

---

### `ConstraintSummary` (`src/components/ConstraintSummary.tsx`)

Below the roster, a collapsible section: "Constraint satisfaction"

**Props:**
```ts
interface ConstraintSummaryProps {
  constraints: (BinaryConstraint | UnaryConstraint)[];
  assignments: StudentAssignment[];
  students: Student[];
}
```

**Content:** A list of all constraints with their satisfaction status for this solution. Compute satisfaction client-side (same logic as in `06-solution-comparison.md`).

**Per constraint row:**
- Green checkmark ✓ or red X ✗
- Human-readable description: e.g. "Alice Smith + Bob Jones: separate (soft, weight 2.0)" — "✓ Satisfied" or "✗ Violated (Alice in Class 1, Bob in Class 1)"
- For violated constraints: show which class(es) involved

**Collapsible:** Collapsed by default. Show a summary count in the header: "12 satisfied · 1 violated"

---

### `MoveStudentControl` (Phase 5 only)

Per student in the roster, a small dropdown or drag handle to move them to a different class.

**Props:**
```ts
interface MoveStudentControlProps {
  studentId: string;
  currentClass: number;
  numClasses: number;
  onMove: (studentId: string, toClass: number) => void;
}
```

**Behavior:**
- Selecting a different class calls `POST /solutions/{id}/override` with the new assignment
- While saving: disable the control, show a spinner on that student row
- On success: update the roster view and the score in the page header (re-score returned by API)
- On error: revert to original class, show toast: "Failed to move student."

**Score update after override:**
The re-score endpoint returns updated `score`, `hard_violations`, `soft_violations`, and per-constraint satisfaction. Update all of these in the UI without reloading.

**Override indicator:**
Once a student has been manually moved, show a subtle "Manually adjusted" badge on their row. Reset if they're moved back to their original class.

---

## API Calls

| Action | Method + Path | Success | Error |
|---|---|---|---|
| Get solution detail | `GET /solutions/{id}` | 200 + Solution with full assignments | 403 → redirect to `/cohorts` |
| Get students (for name lookup) | `GET /cohorts/{cohort_id}/students` | 200 + `Student[]` | Error state |
| Get constraints (for summary) | `GET /cohorts/{cohort_id}/constraints` | 200 + constraints | Error state |
| Manual override (Phase 5) | `POST /solutions/{id}/override` | `{ student_id, class_number }` | 200 + updated score + assignments | Toast error |

---

## Data the page needs on load

1. The solution (`GET /solutions/{id}`) — includes assignments
2. All students in the cohort — for rendering names and tags
3. All constraints in the cohort — for the constraint summary

Fetch (2) and (3) in parallel after (1) resolves (you need the `cohort_id` from the solution to know which cohort to fetch from).

---

## Edge Cases

| Case | Handling |
|---|---|
| Solution has `hard_violations > 0` | Show prominent warning at the top: "⚠ This solution has [N] hard constraint violation(s). This indicates a solver problem — do not use this arrangement." |
| A student in the assignments no longer exists in the cohort (deleted after solve) | Show the student as "[Removed student]" with their ID. Do not crash. |
| Constraint in the summary references a deleted student | Skip that constraint in the summary; it was cascaded on the backend but this solution snapshot is immutable. |
| Teacher tries to move a student to the class they're already in | No-op; don't call the API. |
| Manual override creates a hard violation | API returns updated `hard_violations > 0`. Show a warning: "This manual change violates a hard constraint." Let the teacher undo by moving back. |
| Solution not found or not owned by teacher | API returns 403/404 → redirect to `/cohorts` with toast: "Solution not found." |

---

## Done When

- [ ] Page shows all students grouped by class with first + last name and tags
- [ ] Constraint satisfaction section shows satisfied/violated status per constraint
- [ ] Violated constraints include which class(es) are involved
- [ ] Constraint summary is collapsed by default with counts in the header
- [ ] Share button opens the share modal
- [ ] Page handles a deleted student in assignments gracefully (no crash)
- [ ] (Phase 5) Student can be moved to a different class via dropdown
- [ ] (Phase 5) Score and constraint satisfaction update immediately after move
- [ ] (Phase 5) Manually moved students are marked with an indicator
- [ ] (Phase 5) Hard violation from a manual override shows a warning but allows it
