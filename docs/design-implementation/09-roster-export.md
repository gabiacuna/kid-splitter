# 09 · Roster export (.xlsx)

**Scope:** backend + frontend · **Needs:** 08 · **Status:** new capability

## Server-side, real .xlsx — decided

The handoff specifies:

> generates a CSV of all rows (`Class,Student` header) as a `Blob` (`type: application/vnd.ms-excel`), triggers a browser download named `<solution-label>-class-list.xls`

That's a CSV wearing an Excel MIME type and extension. Excel opens it, but shows *"The file format and extension don't match. The file could be corrupted or unsafe."* first — which, for a teacher downloading a class list, reads as "this app gave me a suspicious file." The handoff concedes the point (*"it is not a true binary `.xlsx` — for production, generate a real `.xlsx`"*), so this is prototype scaffolding, not a spec.

**Build it server-side:** `GET /solutions/{id}/export.xlsx`, a real workbook via `openpyxl`.

Two reasons specific to this codebase. `routers/share.py` already establishes that roster data has redaction rules — `last_name` stripped, tags filtered through `WHITELISTED_TAGS`. Export is exactly the thing that later gets pointed at the share flow, and if it does, redaction must be server-side or it'll be reimplemented (differently, wrongly) in the browser. Second, a plain `<a href>` gets streaming, native download progress, and zero new frontend code — versus SheetJS, a substantial bundle addition for one button.

## Scope: one file per solution — decided

One sheet, `Class | Student`, per solution. The button lives inside a modal scoped to a single solution, and there's no surface where a combined workbook's button would go without inventing one. At that moment the teacher's job is "I've picked this one, give me the list" — the comparison already happened on screen.

Doesn't foreclose a multi-sheet export later; the row-building logic would be shared.

## Backend

- `backend/app/routers/solve.py` (or a new `export.py` if it grows): `GET /solutions/{id}/export.xlsx`, same ownership check as `GET /solutions/{id}`.
- Columns `Class | Student`. Gender is **not** included — it's not in the design. Worth asking whether a teacher printing a list wants it, but don't add it unprompted.
- Sort by class number, then student last name (matching `GET /cohorts/{id}/students` ordering).
- `Content-Disposition: attachment; filename="{safe_label}-class-list.xlsx"`. **Sanitise the label** — it's teacher-supplied text flowing into a response header. Strip quotes, newlines, path separators; use RFC 5987 encoding for non-ASCII.
- Bold header row, sensible column widths. Small effort, and the difference between "a file" and "a usable file".
- Add `openpyxl` to `pyproject.toml`.

## Frontend

- Green "Download .xlsx" button (`oklch(52% 0.13 148)` bg, white text, spreadsheet glyph, 8px radius) at the top-right of the roster-table section in the expanded modal (08).
- A plain anchor to the endpoint — auth is httpOnly cookies (`routers/auth.py`), so no blob handling, no `responseType: 'blob'` on the axios client, and the file streams rather than buffering in memory.
- No confirmation dialog, per the handoff.

## Verification

- Download and **open in Excel and Google Sheets. No format warning** — that warning is the entire reason this feature exists.
- A solution label containing quotes, a slash, or an accented character → well-formed header, download succeeds.
- Row count matches the cohort's student count; every student appears exactly once.
- Another teacher's solution ID → 403/404, no data leak.
