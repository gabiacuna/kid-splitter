# Feature: Student Management (Manual Add · CSV Import · Tags)

> Agent context: Students belong to a cohort. They have a first name, last name, and an array of tags. Last names are never shown on share links. Import is a two-step preview-then-confirm flow — nothing is persisted until the teacher explicitly confirms.

---

## Goal

Let teachers populate a cohort with students either one at a time or by uploading a CSV. Tags can be added or edited at any point. Students can be removed individually.

---

## Components

### `StudentListPage` (`src/pages/StudentListPage.tsx`)

Route: `/cohorts/:id/students` (also rendered as the Students tab on `CohortDetailPage`)

**Layout:**
- Header row: student count ("32 students"), "Add student" button, "Import CSV" button
- Table of students (see `StudentTable`)
- If 0 students: empty state with both buttons prominent

---

### `StudentTable` (`src/components/StudentTable.tsx`)

**Props:**
```ts
interface StudentTableProps {
  students: Student[];
  onDelete: (id: string) => void;
  onTagsChange: (id: string, tags: string[]) => void;
}

interface Student {
  id: string;
  first_name: string;
  last_name: string;
  tags: string[];
  import_source: 'csv' | 'manual';
}
```

**Columns:** First name · Last name · Tags · Actions

**Tags display:** Each tag is a small pill/badge. Click a tag pill to remove it. Click "+" at the end of the tag list to add a new one (inline text input, confirm on Enter or blur).

**Tag input rules (enforce client-side):**
- Alphanumeric + hyphens only
- Max 30 chars per tag
- Max 10 tags per student
- Duplicate tags silently ignored

**Actions column:** "Delete" button per row.

**States:**

| State | Behavior |
|---|---|
| Saving tag change | Row shows subtle spinner; tag UI disabled until save completes |
| Tag save error | Revert to previous tags, show toast: "Failed to update tags." |
| Deleting a student | Confirmation: "Remove [first name] [last name]? Constraints involving this student will also be removed." |
| Delete success | Row removed from table |
| Delete error | Toast: "Failed to remove student." |

---

### `AddStudentForm` (`src/components/AddStudentForm.tsx`)

Inline form below the table header (or a small modal — your call).

**Fields:**
- First name (text, required, max 100 chars)
- Last name (text, required, max 100 chars)
- Tags (optional, same tag input as `StudentTable`)
- Submit: "Add student"

**States:**

| State | Behavior |
|---|---|
| Idle | Form enabled |
| Submitting | Button: "Adding…", inputs disabled |
| Success | Clear form, focus first name field, append new student to table |
| Error — validation | Inline per field |
| Error — server | "Failed to add student. Try again." |

---

### `CsvUploadButton` (`src/components/CsvUploadButton.tsx`)

A styled file input. Accepts `.csv` only. On file selection, immediately POSTs to `/cohorts/{id}/students/import` (multipart/form-data).

**States:**

| State | Behavior |
|---|---|
| Idle | Button: "Import CSV" |
| Uploading | Button: "Uploading…", disabled |
| Success | Open `CsvPreviewModal` with the preview payload |
| Error — file too large (>5 MB) | Client-side: "File too large. Maximum 5 MB." |
| Error — too many rows (>500) | Server returns 422; show: "Too many rows. Maximum 500 students per import." |
| Error — server | "Import failed. Check your file format and try again." |

---

### `CsvPreviewModal` (`src/components/CsvPreviewModal.tsx`)

Shown after a successful upload, before any data is committed.

**Props:**
```ts
interface CsvPreviewModalProps {
  cohortId: string;
  rows: PreviewRow[];
  onConfirm: () => void;
  onCancel: () => void;
}

interface PreviewRow {
  first_name: string;
  last_name: string;
  tags: string[];
  status: 'ok' | 'duplicate' | 'missing_name';
}
```

**Table columns:** First name (editable) · Last name (editable) · Tags (editable inline) · Status badge

**Status badges:**
- `ok` → green "OK"
- `duplicate` → yellow "Duplicate" — teacher can keep, remove row, or edit the name
- `missing_name` → red "Missing name" — teacher must fix before confirming (confirm button disabled if any `missing_name` rows remain)

**Editing in preview:** All cells editable inline. Changes only affect the preview state; nothing is saved yet.

**Footer:**
- "Cancel" → discard preview, close modal, no data committed
- "Confirm import ([n] students)" → disabled if any `missing_name` rows; calls `POST /cohorts/{id}/students/import/confirm`

**Confirm states:**

| State | Behavior |
|---|---|
| Submitting | Button: "Importing…", disabled |
| Success | Close modal, refresh student list, show toast: "[n] students added." |
| Error | "Import failed. Try again." Keep modal open. |

---

## API Calls

| Action | Method + Path | Request/format | Success | Error |
|---|---|---|---|---|
| List students | `GET /cohorts/{id}/students` | — | 200 + `Student[]` | Error state in table |
| Add student manually | `POST /cohorts/{id}/students` | `{ first_name, last_name, tags }` | 201 + `Student` | 422 validation |
| Upload CSV (preview) | `POST /cohorts/{id}/students/import` | `multipart/form-data`, field: `file` | 200 + `PreviewRow[]` | 413 too large, 422 too many rows |
| Confirm import | `POST /cohorts/{id}/students/import/confirm` | `{ rows: PreviewRow[] }` (edited rows) | 201 + `Student[]` | 422 |
| Update tags | `PUT /students/{id}` | `{ tags }` | 200 + `Student` | Revert + toast |
| Delete student | `DELETE /students/{id}` | — | 204 | Toast error |

---

## CSV Format

The expected CSV format (document in a tooltip or help text near the upload button):

```
first_name,last_name,tags
Alice,Smith,needs-support
Bob,Jones,behavioural|gifted
Carol,Lee,
```

- Tags column: pipe-separated (`|`), optional
- Header row required
- Cells starting with `=`, `+`, `-`, `@` are rejected server-side (CSV injection protection)

---

## Edge Cases

| Case | Handling |
|---|---|
| CSV has duplicate names (same first + last) | Server flags as `duplicate` in preview; teacher decides |
| Student deleted while a constraint references them | `ON DELETE CASCADE` removes constraint on backend. After deletion, show toast: "Student removed. Any constraints involving [name] were also removed." |
| Tag with invalid characters typed | Reject character client-side as it's typed (regex filter), no error message needed |
| Import confirm with 0 valid rows | Confirm button disabled; show: "No valid students to import." |
| Student count exceeds 500 in cohort | No block at MVP — this is a soft limit on the solver side, not enforced on the student list |
| Very long first or last name | API rejects at 100 chars; client validates and shows: "Name must be 100 characters or fewer." |

---

## Done When

- [ ] Students table renders with name, last name, tags, and delete button
- [ ] Tags can be added and removed inline; changes save to the API
- [ ] Single student can be added via form and immediately appears in table
- [ ] CSV upload shows a preview before committing any data
- [ ] Duplicate and missing-name rows are flagged in the preview
- [ ] Teacher can edit rows in the preview before confirming
- [ ] Confirmed import appends students to the table with success toast
- [ ] Deleting a student requires confirmation and shows constraint-removal warning
- [ ] Cancel on the CSV preview commits nothing
