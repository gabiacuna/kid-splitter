# 01 · UI pass: errors, import, guidance, auth & a11y

**Scope:** backend + frontend · **Status:** implemented, uncommitted (see "Outcome" at the end)

A review pass over the whole app from a teacher's point of view: what happens when the
network or the server fails, what the CSV import silently drops, which words a teacher
won't understand, and the accessibility gaps. Five phases, done in order; each phase must
leave `npm run build`, `npm run lint` and `uv run pytest` green.

## Phase 0 — shared components

| Component | File | Contract |
|---|---|---|
| `HelpTip` | `components/HelpTip.tsx` | Small ⓘ button. Tooltip on hover, focus and tap; `aria-describedby` points at the tooltip; Escape closes; text comes from i18n. |
| `Modal` | `components/Modal.tsx` | `role="dialog"`, `aria-modal`, `aria-labelledby` the title, focus moves in, Tab is trapped, focus returns to the opener, body scroll locked. |
| `ErrorState` | `components/ErrorState.tsx` | Icon + plain message + "Reintentar" button that calls the query's `refetch`. |
| `Toast` | `components/Toast.tsx` | `role="status"`/`aria-live` container; errors stay ~7 s with a close button, success 3.5 s; at most 3 stacked. |

**Decision — when a modal may close by itself.** Overlay click *and* Escape close the
modal only while its form is pristine (`dirty={false}`) and nothing is saving (`busy`).
Once the teacher has typed, only Cancel/Close closes it. Escape is treated like the
overlay, not as an explicit "cancel", because a stray Escape (e.g. closing a native
`<select>`) must not throw away a half-filled form either. The CSV preview is always
"dirty" (it is the teacher's work), so it only closes with Cancel.

Migrated: dashboard create/edit/delete, `ShareModal`, cohort delete (`CohortDetailPage`),
CSV preview (`CsvUpload`), `RosterModal`, profile delete-account.

## Phase 1 — connection & error screens

- `lib/api.ts`: 20 s default timeout; the solve call passes 60 s (three variants × 8 s
  solver limit plus overhead). Requests that fail with no response (network down,
  timeout) dispatch `api:network-error`.
- `components/ErrorBoundary.tsx` around the routes: "Algo salió mal" + "Recargar".
- `components/ConnectionBanner.tsx`: shown on `offline` or `api:network-error`; while
  shown it polls `/api/health` every 5 s and hides on success.
- `AuthContext`: `/auth/me` 401 → try `/auth/refresh` once → retry; only a failed refresh
  means "logged out". Network/5xx → `status: 'unreachable'`, `ProtectedRoute` shows a
  connection error screen with retry instead of redirecting to the login page.
- Forced logout (`auth:logout`) navigates to `/login` with `state.sessionExpired`, and
  the login page shows "Tu sesión expiró, inicia sesión de nuevo".
- Per page: constraints, solutions, cohort detail, solution detail, profile summary,
  dashboard, student list, roster modal → `ErrorState` / inline error with retry.
  Solutions: if the rule check (`/constraints/validate`) fails, Generate is disabled with
  "No pudimos comprobar las reglas" + retry (it used to fall back to "no contradictions").
  Cohort detail: redirect + toast only on 403/404; other errors show `ErrorState`.
  Solve: cancel button (`AbortController`), and timeout/network errors get their own message.
  Public share page: not found/revoked vs network error, each with a next step.

## Phase 2 — import

### A) Multi-select, per-student, key-based

**API contract change.**

- Every match candidate has a stable **key**: an existing student's id, or `row:<row_index>`
  for an upload row.
- `PreferenceMatchOut` = `{name, status, matched_key, matched_display, suggestions: [{key, display, source: 'existing'|'upload', row_index}]}`.
  `/import/rematch` returns the same shape.
- `POST /import/confirm` body:
  ```json
  {
    "students": [{"row_index": 3, "first_name": "…", "last_name": "…", "tags": [], "gender": null,
                  "preference_keys": ["<student id>", "row:7"]}],
    "existing_preferences": [{"student_id": "<id>", "display": "Emma Ruiz", "preference_keys": ["row:2"]}]
  }
  ```
  The backend no longer re-matches names: it resolves keys directly (`row:N` → the student
  created for row N). Keys must be a student of this cohort or a row in `students`;
  anything else is skipped and reported. Self-pairs are ignored; pairs are deduped
  against existing rules and within the upload (unchanged).
- Response adds a summary:
  `{students, constraints_created, existing_updated: [{display, constraints_created}], skipped_preferences: [{owner, target, reason}]}`
  with `reason ∈ target_not_imported | unknown_student`. The UI shows it after confirm
  (instead of closing silently) whenever it isn't empty.

**UI.** Pending names are grouped by name. Header: name, how many students list it,
the candidates. One row per owner with a checkbox per candidate (several may be ticked —
each becomes a "juntos" rule), plus "omitir" and "añadir como nuevo/a" (when the name has
a first and last name). A group-level "Aplicar a todos" row fills every owner row (still
editable per row) and "Omitir todos" skips the group. With a single owner only that row
is shown. A group is decided when every owner row has ≥1 ticked candidate or is skipped.
Unresolved names keep the free-text edit + `/rematch`.

### B) Duplicates

`duplicate` splits into:

- `duplicate_exact` — in-upload: every column equals an earlier row (after trimming);
  existing: name, gender and tags equal an existing student. **Default not imported.**
- `duplicate_similar` — same name, some field differs. **Default imported**, flagged
  "posible duplicado" with the fields that differ (`status_params.fields`).

Every row gets an include/exclude checkbox. `importable` keeps meaning "the server would
import this by default"; the client's `include` starts from it.

**Edge case (decided).** A `duplicate_exact` of an existing student that lists
preferences: the student isn't created, but its preferences are added to the existing
student (`existing_student_id` on the row, sent as `existing_preferences`), and the
summary says so. Exact duplicates are left out of the match index (their twin already is).

### C) Other import fixes

- Editing a name in the preview re-validates the row on the client (blank/injection →
  missing name; same name as another row or a cohort student → possible duplicate; else OK).
- Row messages are sent as `status_code` + `status_params` and translated client-side;
  the English `status_message` stays for API readers. Column notes likewise get
  `code` + `params`.
- Delimiter `;`/`,`/tab detected from the header line; decoding tries UTF-8 (BOM-tolerant),
  then cp1252, then latin-1 (no more `errors="replace"`). No recognisable name column →
  422 `{code: "no_name_column"}`. 422 details are `{code, message}`; the frontend maps
  `too_many_rows`, `no_name_column`, `empty_file`, and 415 separately.
- Router accepts Excel's CSV mime types (`application/vnd.ms-excel`, `text/plain`,
  `application/octet-stream`, … when the file name ends in `.csv`).
- Single "nombre completo" column: the preview response includes `name_split` (column,
  order, an example); the modal shows how names were split and a toggle that re-uploads
  with `name_order=given_first|surname_first` (edits made before toggling are lost; the
  note says so).
- CSV help (HelpTip) + "Descargar plantilla" next to "Importar CSV" (generated client-side,
  headers in the current language).
- "Añadir como nuevo/a" disabled reason shown inline.
- Student list: delete confirm warns when the student has rules and the toast only claims
  rules were removed when there were some; tag edits read the latest cache (race fix);
  success toast on manual add; search box.

## Phase 3 — tooltips & guidance

HelpTips (Spanish wording in `i18n/es/Guidance.ts`): Juntos/Separados, Obligatoria,
Peso, contradiction/conflict banners, score, violation chips, "no probado óptimo",
gender balance, class count/target size, tags, preference map, share, Active/Draft.
"soft, w5.0" → "flexible, peso 5".

- 3-step indicator in the cohort header: Alumnos → Preferencias (opcional) → Listas,
  ticked from data, each step switches the tab (`?tab=`).
- Empty states for constraints, dashboard and solutions explain the next step.
- Disabled buttons show their reason next to them (`aria-describedby`), not only as
  `title`. "Resuelve las contradicciones" links to `?tab=constraints`.
- Spanish strings lose jargon (generador/solver, restricción, flexible/soft, "nombres para juntar").
- Hard-violation banner gets "Vuelve a generar las listas".

## Phase 4 — auth, a11y, polish

- **Forgot password.** `/forgot-password` page → `POST /auth/forgot-password {email}`
  (rate-limited 5/hour, neutral answer) → Supabase `POST /auth/v1/recover?redirect_to=<FRONTEND_URL>/reset-password`.
  The email link lands on `/reset-password#access_token=…&type=recovery`; that page posts
  `{access_token, new_password}` to `POST /auth/reset-password` (rate-limited), which calls
  Supabase `PUT /auth/v1/user` with the recovery token. Expired/invalid link → 400 with a
  "request a new link" next step.
  **Manual Supabase setting required:** add `<FRONTEND_URL>/reset-password` (e.g.
  `http://localhost:5173/reset-password` and the production URL) to *Authentication →
  URL Configuration → Redirect URLs*. Without it Supabase falls back to the Site URL and
  the link won't open the reset page. Also tracked in `docs/TODO.md`.
- Labels (`htmlFor`/`id`) on login, register, dashboard modals, add-student form, tag
  inputs, CSV preview inputs; `role="alert"` on auth errors; decorative icons/emoji
  `aria-hidden`; accessible names on icon-only buttons; card menu `aria-haspopup`/
  `aria-expanded`, arrow keys and Escape.
- `index.css`: global `:focus-visible`, `prefers-reduced-motion`, `--text3` and the
  success-toast colour raised toward 4.5:1, 44 px touch targets for the card kebab,
  one-column create-modal grid on phones, public share page styles moved to CSS.
- Language toggle on login, register, forgot/reset password and the public share page.
- Register: real 422 detail, visible password rule, "use a different email" on the
  check-your-email screen. Cohort create: year validated (2000–2100).
- Matched vs unmatched preference chips differ by icon + text, not only colour.
- `frontend/docs/03-student-import.md` corrected.

## Outcome

All five phases are implemented. Gates at the end: `npm run build` ✓, `npm run lint` ✓ (only
warnings that were already there), `uv run pytest` ✓ (25 passed). **The Playwright suite was not
run**: no stack was reachable on `localhost:8000`. The specs were updated but have not been run.

### Changed from the plan, and why

- **Modal dismissal.** Escape follows the same "pristine only" rule as the overlay (see Phase 0).
  The roster, share and delete-confirmation dialogs have no form, so they still close on Escape.
- **Solve errors.** The old code expected 409 for "no valid arrangement", but the backend sends
  422 in three cases (contradictions, infeasible, too few students). The frontend now tells
  them apart by `detail`, so "no valid arrangement" can show at all. 429 (rate limit) gets its
  own message.
- **Cancel solve** only stops the browser waiting. The server keeps running and may still save
  the lists, so the panel says so and refreshes the list.
- **Constraint header.** The "Obligatoria" column header is now visible to assistive tech (no
  longer `aria-hidden`) and carries the HelpTips. Each checkbox keeps its own `aria-label`. The
  row cells were not widened.
- **Name-order toggle** re-uploads the same file with `name_order`, so edits made in the preview
  are lost. The note warns about this.
- **"Añadir como nuevo/a"** adds the new student once per name group and ticks it for the chosen
  owner, or for all owners from the "Apply to all" row.
- **Lint baseline.** `npm run lint` failed before this pass: Playwright's fixture `use` callback
  tripped `rules-of-hooks`. The parameter is renamed to `provide` in `e2e/support/fixtures.ts`.
- **pytest** wasn't installed. It is now a dev dependency (`uv add --dev pytest`;
  `pyproject.toml` and `uv.lock` changed). README test instructions now say `uv run pytest`.

### Deferred

- **Conflict explanations** (contradiction "Why?") are still English sentences built in
  `services/validator.py`. Translating them needs a code+params contract like the import's.
  Added to `docs/TODO.md`.
- **Real Supabase password-reset email** is untested (mocked in e2e and pytest). It needs the
  redirect URL configured (see Phase 4 and `docs/TODO.md`).
- Client-side duplicate re-checks after a rename are approximate: there are no raw columns on the
  client, so an in-upload rename is always "possible duplicate", never "exact".

### Tests added or changed

- `backend/tests/test_csv_import.py`: delimiter and encoding detection, missing header, row
  limit, name-order toggle, status codes, mime types, exact/similar duplicates (in-upload and
  existing), keyed matching and self-exclusion, confirm planning (key resolution, dedupe,
  skipped report, preferences added to existing students).
- `backend/tests/test_password_reset.py`: recover/reset outcomes, plus endpoint tests with
  Supabase mocked (neutral answer, `redirect_to`, rate limit, recovery token, expired link).
- `frontend/e2e/import.spec.ts`: multi-select decisions, duplicate re-upload with the summary
  dialog, missing-header error (fixture `school-export-again.csv`).
- `frontend/e2e/auth.spec.ts`: forgot/reset password (mocked), language switch on login.
- `frontend/e2e/dashboard.spec.ts` and `gender.spec.ts`: card menu items are now `menuitem`, and
  keyboard/Escape behaviour is asserted.
