# 01 · Student gender

**Scope:** backend + frontend · **Blocks:** 02, 03, 07 · **Status:** new capability

The design's boy/girl balance bars and the gender-balance soft constraint both require a gender attribute on students. Nothing in the stack has one — `Student` carries only `first_name`, `last_name`, `tags[]`, `import_source`.

## Decisions

**Model: `'boy' | 'girl' | null`.** Nullable, because a real roster will have unknowns and a non-nullable column forces the importer to guess. `null` means "unknown" and is a first-class UI state, not an error. The design language is "boy / girl" throughout, which is what a teacher balancing a class list works with.

Students who are neither are represented as `null`: excluded from balance calculations, free to be placed anywhere. *(Settled by implication when the click-cycle below was accepted — flagging in case you want to revisit.)*

**Data source: CSV sometimes has it, sometimes doesn't** — depends on the school. So manual entry is not a fallback path, it's a primary one. See *Inline editing* below.

**No migration file.** The product is undeployed; the column goes straight into `001_initial_schema.py`. See `10-class-count-cap.md` for the full schema-consolidation note.

## Backend

**Schema** — `001_initial_schema.py`, `students` table:

- `gender VARCHAR NULL`
- CHECK constraint restricting to `('boy','girl')` so bad values can't be written even outside the API. A Postgres enum is the alternative but is painful to widen later; a CHECK is easier.

**Model** — `backend/app/models/student.py`:

```python
gender: Mapped[str | None] = mapped_column(String, nullable=True)
```

**Schemas** — `backend/app/schemas/student.py`: add `gender: Optional[Literal["boy", "girl"]] = None` to create, update, and out. `Literal` gives validation for free — no custom `field_validator` needed, unlike the `weight`/`year` validators elsewhere in this file.

### The `null` problem — must be solved, not deferred

Every partial-update schema in this codebase uses `Optional[X] = None` to mean **"field absent, don't touch it"**. That collides head-on with `null` meaning **"gender is unknown"**.

The click-cycle below includes empty as a reachable state (`empty → boy → girl → empty`), so a teacher *will* cycle a student back to unknown, and that write must persist. As things stand it would be indistinguishable from "no change" and silently do nothing.

Fix with Pydantic v2's `model_fields_set`, which records what the client actually sent:

```python
if "gender" in payload.model_fields_set:
    student.gender = payload.gender   # may legitimately be None
```

Apply this only to `gender` — don't refactor the other fields' semantics as part of this work.

**Router** — `backend/app/routers/students.py`: `POST` passes `gender` through; `PUT` uses the `model_fields_set` check above.

### CSV import

`backend/app/services/csv_import.py`. Headers are already lowercased and stripped into a `DictReader` (line ~50), so an absent `gender` column naturally yields `None` — no special-casing needed.

- Normalise an accepted set → `boy` / `girl`: `b`, `boy`, `m`, `male` and `g`, `girl`, `f`, `female`, case-insensitive.
- Unrecognised non-empty value → **not** a row failure. Set `None`, add an `invalid_gender` status alongside the existing `invalid_tag`, keep the row importable — matching how `invalid_tag` already behaves.
- Empty or absent → `None`, silently. A cohort with no gender data is normal.
- Update the documented column list in the `StudentListTab` empty state: `first_name,last_name,tags,preferences` → add `gender` as optional.

## Frontend

**Types** — `frontend/src/lib/types.ts`: `gender?: 'boy' | 'girl' | null` on `Student`; `'invalid_gender'` added to `PreviewRow['status']`.

### Inline editing (click-to-cycle)

This is the load-bearing piece. Because school exports only *sometimes* carry gender, a teacher may import 28 students and get 28 nulls. Without this, they tick "prioritize a balanced mix", the solver has nothing to balance on, and nothing happens — with no way to fix it and no explanation.

`frontend/src/components/StudentTable.tsx` currently has exactly one mutation, line ~90: `api.put('/students/${id}', { tags })`. Extend the same pattern.

- New Gender column whose cell is a **click-to-cycle** control: `empty → Boy → Girl → empty`.
- Optimistic update, no per-row save button.
- Renders `null` as a muted em-dash (`--text3`), so "unknown" is visibly distinct from a rendering bug.
- A 28-student roster becomes ~28 clicks in one pass down the table — deliberately chosen over a dedicated bulk-assignment screen, which would be better ergonomics for more work and a screen the design never contemplated.

Needs keyboard support: the cell is interactive, so it must be focusable and cycle on Enter/Space. A `<button>` is the right element.

**Add student form** — `frontend/src/components/AddStudentForm.tsx`: three-way control (Boy / Girl / Not specified). Radio pills rather than a `<select>` — three options is below the threshold where a dropdown earns its click.

**CSV upload preview** — `frontend/src/components/CsvUpload.tsx`: show the gender column, surface `invalid_gender` in the same treatment as `invalid_tag`.

## Verification

- Import a CSV with a `gender` column, without one, and one containing `"M"`, `"female"`, `"unknown"`, and an empty cell. First two map correctly; `"unknown"` yields `invalid_gender` **and still imports**; empty is silently `null`.
- **Cycle a student to Boy, then Girl, then back to empty. Reload. It must still be empty** — this is the `model_fields_set` fix; without it the last step silently no-ops.
- Tab to a gender cell and cycle it with the keyboard alone.
- Add a student via the form with "Not specified" → `null`, not `""`.
