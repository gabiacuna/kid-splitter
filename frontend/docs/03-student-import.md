# Feature: Student Management (Manual Add · CSV Import · Tags)

> Agent context: Students belong to a cohort. They have a first name, last name, and an array of tags. Last names are never shown on share links. Import is a two-step preview-then-confirm flow — nothing is persisted until the teacher explicitly confirms.

---

## Goal

Let teachers populate a cohort with students either one at a time or by uploading a CSV. Tags can be added or edited at any point. Students can be removed individually.

---

## Components

### `StudentListTab` (`src/pages/StudentListTab.tsx`)

Rendered as the Students tab on `CohortDetailPage` (`/cohorts/:id?tab=students`); there is no separate route.

**Layout:**
- Header row: student count ("32 students"), "Add student" button, "Import CSV" button with a format tip (ⓘ) and "Download template"
- Search box (name or tag) above the table (see `StudentTable`)
- If 0 students: empty state with the CSV column list
- Load error: `ErrorState` with "Retry"

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
| Tag save error | Resync from the server, show toast: "Failed to update tags." (edits are applied optimistically from the latest cache, so two quick edits never undo each other) |
| Deleting a student | Confirmation: "Remove [first name] [last name]?" — plus "Their N preferences will be deleted too." only when the student has rules |
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
| Success | Clear form, focus first name field, append new student to table, toast "[name] added." |
| Error — validation | Inline per field |
| Error — server | "Failed to add student. Try again." |

---

### `CsvUploadButton` + `PreviewModal` (`src/components/CsvUpload.tsx`, state helpers in `src/lib/importPreview.ts`)

A file input that accepts `.csv` (Excel's `application/vnd.ms-excel` and `text/plain` are accepted by the server when the name ends in `.csv`). On file selection it POSTs to `/cohorts/{id}/students/import` (multipart: `file`, optional `name_order`).

**Upload errors** (each has its own message): client-side > 5 MB; 415 not a CSV; 413 too large; 422 `{code}` = `too_many_rows` (> 500), `no_name_column` (no header row / no name column — lists the headers found), `empty_file`; network error.

**Preview** (nothing is saved until confirm):

- Columns: Import (checkbox per row) · First name · Last name (editable) · Gender · Tags · Pair with · Status (badge + translated explanation from `status_code`/`status_params`).
- Statuses: `ok`; `invalid_gender` (imported, gender unknown); `missing_name`, `invalid_tag` (skipped, checkbox disabled); `duplicate_exact` (every column equals an earlier row, or name + gender + tags equal a cohort student — **unticked by default**); `duplicate_similar` (same name, something differs — **ticked**, flagged "Possible duplicate" with the differing fields).
- Editing a name re-validates the row on the client (a fixed "Missing name" becomes importable; renames can create or clear a duplicate).
- A single "nombre completo" column shows how names were split, with a button to re-read the file the other way round (surname first ↔ given name first).
- **Classmate decisions**: names that matched nobody or several students are grouped by name. Each listing student gets a checkbox per candidate (several may be ticked — each becomes a "together" preference), "Skip", and "Add as a new student" (only when the name has a first and last name; otherwise the reason is shown inline). With several listing students there is an "Apply to all" row and "Skip all". Unmatched chips in the table can be edited to re-match (`/import/rematch`).
- Matched chips show ✓, unmatched ones ? — not only colour.
- Confirm is disabled, with the reason next to it, while names are undecided or no row is ticked.

**After confirm**: a toast when everything went in; otherwise an "Import finished" dialog listing rows not imported, preferences added to students already in the cohort, and preferences that couldn't be created (e.g. the classmate's row was unticked).

## API Calls

| Action | Method + Path | Request/format | Success | Error |
|---|---|---|---|---|
| List students | `GET /cohorts/{id}/students` | — | 200 + `Student[]` | `ErrorState` + Retry |
| Add student manually | `POST /cohorts/{id}/students` | `{ first_name, last_name, tags, gender }` | 201 + `Student` | 422 validation |
| Upload CSV (preview) | `POST /cohorts/{id}/students/import` | `multipart/form-data`: `file`, `name_order?` (`surname_first`\|`given_first`) | 200 + `{ rows, column_notes, name_split, … }` | 413, 415, 422 `{code, message}` |
| Re-match one name | `POST /cohorts/{id}/students/import/rematch` | `{ name, self_row_index, rows }` | 200 + `PreferenceMatch` | — |
| Confirm import | `POST /cohorts/{id}/students/import/confirm` | `{ students: [{ row_index, first_name, last_name, tags, gender, preference_keys }], existing_preferences: [{ student_id, preference_keys }] }` | 201 + `{ students, constraints_created, existing_updated, skipped_preferences }` | 422 |
| Update tags / gender | `PUT /students/{id}` | `{ tags }` or `{ gender }` | 200 + `Student` | Resync + toast |
| Delete student | `DELETE /students/{id}` | — | 204 | Toast error |

**Keys.** Every preview candidate has a stable key: an existing student's id, or `row:<row_index>` for an upload row. A preference is `{ name, status, matched_key, matched_display, suggestions: [{ key, display, source, row_index }] }`. Confirm sends the chosen keys; the server resolves them directly (no name re-matching), ignores self-pairs and pairs that already exist, and reports anything it couldn't use in `skipped_preferences`.

---

## CSV Format

A header row is required. Spanish or English headers both work, and `,`, `;` or tab as the separator (detected from the header line). Encoding: UTF-8 (with or without BOM), then Windows-1252, then Latin-1.

```
nombres,apellidos,genero,etiquetas,preferencias
Lucía,García Pérez,niña,"apoyo,lectura",Mateo Soto|Ana Ruiz
Mateo,Soto Díaz,niño,,Lucía García
```

- Names: `first_name`/`nombres` + `last_name`/`apellidos`, or one `nombre`/`name`/`nombre completo` column (read surname-first by default: "Arce Molina Sofía").
- `etiquetas` / `tags`: **comma-separated** within the cell (quote the cell if the separator is also a comma).
- `genero` / `gender`: niño/niña, boy/girl, h/m, b/g, m/f… unrecognised → imported as unknown.
- `preferencias` / `preferences`: classmates **pipe-separated** (`|`), or several `Preferencia 1`, `Preferencia 2`… columns.
- Other columns become tags when their values group students (e.g. `Curso`: 2°A/2°B); IDs, list numbers and free text are ignored (shown as column notes).
- Cells starting with `=`, `+`, `-`, `@` are rejected server-side (CSV injection protection).
- "Download template" next to the button gives a ready-made file in the current language.

---

## Edge Cases

| Case | Handling |
|---|---|
| CSV has duplicate names (same first + last) | `duplicate_exact` (unticked) or `duplicate_similar` (ticked, differing fields shown); teacher decides per row |
| Exact copy of a cohort student that lists new classmates | No new student; the new preferences are added to the existing student and listed in the summary |
| Student deleted while a constraint references them | `ON DELETE CASCADE` removes constraint on backend. The confirmation warns first; the toast mentions removed preferences only if there were any. |
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
- [ ] Deleting a student requires confirmation and warns when it has preferences
- [ ] Cancel on the CSV preview commits nothing
