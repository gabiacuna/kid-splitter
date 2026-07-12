# Feature: Cohort Management (Dashboard · Create · Edit · Delete)

> Agent context: Cohorts are the top-level container. Each teacher owns their own cohorts; the API enforces isolation via `teacher_id`. The frontend never renders another teacher's data.

---

## Goal

Give the teacher a dashboard to see all their cohorts and navigate into one. Allow creating, renaming, and deleting cohorts. A cohort must exist before students or constraints can be added.

---

## Components

### `CohortDashboardPage` (`src/pages/CohortDashboardPage.tsx`)

Route: `/cohorts`

Displays a list of cohort cards. Each card is a link into the cohort.

**Card content:**
- Cohort name
- Year (if set)
- Student count (from `GET /cohorts/{id}` or included in list response)
- Last solve date (from `solutions` — show "No solves yet" if none)
- "Open" button → navigates to `/cohorts/:id`

**Page states:**

| State | Behavior |
|---|---|
| Loading | Show skeleton cards (3 placeholder rows) |
| Empty (no cohorts) | Show: "No cohorts yet. Create your first one." + primary "New cohort" button |
| Loaded | Grid/list of cohort cards + "New cohort" button in top-right |
| Error | "Failed to load cohorts. Refresh to try again." |

---

### `CreateCohortModal` (or inline page at `/cohorts/new`)

Triggered by the "New cohort" button. Can be a modal or a dedicated page — your call, but keep it simple.

**Fields:**
- Cohort name (text, required, max 100 chars)
- Year (number, optional, e.g. 2026)
- Number of classes (number, required, between 2 and 20) — this is the initial value; teachers can change it before solving

**States:**

| State | Behavior |
|---|---|
| Idle | Form enabled, submit button: "Create cohort" |
| Submitting | Button: "Creating…", inputs disabled |
| Success | Close modal / navigate to `/cohorts/:id` |
| Error — validation | Inline per field: name required, num_classes 2–20 |
| Error — server | "Something went wrong. Try again." |

---

### `CohortDetailPage` (`src/pages/CohortDetailPage.tsx`)

Route: `/cohorts/:id`

The hub for a single cohort. Contains three tabs:

| Tab label | Content |
|---|---|
| Students | Student list (see `03-student-import.md`) |
| Constraints | Constraint editor (see `04-constraint-editor.md`) |
| Solutions | Solution list (links to detail; see `06-solution-comparison.md`) |

**Page header:**
- Cohort name (editable inline — click to edit, Enter to save, Escape to cancel)
- Year (editable inline, same pattern)
- "Delete cohort" button (danger, right-aligned)

**Tab persistence:** store active tab in URL query param (`?tab=students`) so refresh/back works.

---

### `EditCohortInline`

Inline editing of cohort name and year directly in the `CohortDetailPage` header. Not a separate modal.

**Behavior:**
- Click name → input appears, pre-filled with current value
- Enter or blur → `PUT /cohorts/{id}` with updated field
- Escape → discard, revert to original
- Show a subtle saving spinner while the request is in flight
- On success: update displayed value
- On error: revert value, show toast: "Failed to save. Try again."

---

### `DeleteCohortButton`

**Behavior:**
- Click → confirmation dialog: "Delete [cohort name]? This will permanently remove all students, constraints, and solutions. This cannot be undone."
- Confirm → `DELETE /cohorts/{id}` → navigate to `/cohorts` on success
- Cancel → dismiss dialog
- While deleting: disable confirm button, show "Deleting…"
- On error: "Failed to delete cohort. Try again." Keep dialog open.

---

## API Calls

| Action | Method + Path | Request body | Success | Error |
|---|---|---|---|---|
| List cohorts | `GET /cohorts` | — | 200 + `Cohort[]` | Show error state |
| Create cohort | `POST /cohorts` | `{ name, year?, num_classes }` | 201 + `Cohort` | 422 → validation errors |
| Get cohort detail | `GET /cohorts/{id}` | — | 200 + `Cohort` with student count | 403 → redirect to `/cohorts` |
| Update cohort | `PUT /cohorts/{id}` | `{ name?, year?, num_classes? }` | 200 + updated `Cohort` | Show inline error |
| Delete cohort | `DELETE /cohorts/{id}` | — | 204 | Show error in dialog |

Use TanStack Query: `useQuery` for GET, `useMutation` for POST/PUT/DELETE. Invalidate `['cohorts']` on any mutation.

---

## Edge Cases

| Case | Handling |
|---|---|
| Teacher visits `/cohorts/:id` for a cohort they don't own | API returns 403 → redirect to `/cohorts` with toast: "Cohort not found." |
| Cohort has students/solutions — teacher tries to delete | No block on frontend. Confirmation copy makes clear everything is deleted. Cascade happens on backend. |
| `num_classes` changed on an existing cohort that already has solutions | Show warning banner on the Solutions tab: "Class count changed since last solve. Previous solutions used a different configuration." |
| Cohort name left blank on inline edit | Revert to previous name without calling API |
| Two tabs open simultaneously editing the same cohort | Last write wins; no special handling needed at MVP |

---

## Done When

- [ ] Dashboard shows all cohorts with student count and last solve date
- [ ] "No cohorts yet" empty state renders for new teachers
- [ ] Teacher can create a cohort and is taken to its detail page
- [ ] Cohort name and year can be edited inline without a page reload
- [ ] Deleting a cohort requires confirmation and returns to dashboard
- [ ] Visiting a cohort that doesn't belong to the teacher redirects to dashboard
- [ ] Active tab persists on page refresh via URL query param
