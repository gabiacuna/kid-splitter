# 11 · Profile page: edit school, delete account

**Scope:** backend + frontend · **Status:** planned, not started

A page where a teacher can change their school name and permanently delete their account
along with all their data. Not in the design handoff; follows its visual language.

## Where it lives

- Route `/profile`, behind login.
- The school name in the nav (`Nav.tsx`, `.nav-school`) becomes a link to it — that's where
  people look for "my account".
- Two sections on one page: **School** (editable) and **Delete account** (a "danger zone"
  at the bottom: coral border, separated from everything else).

## Edit school name

**Backend:** `PUT /auth/me` with `{school_name}`, same validation as registration
(trimmed, 1–200 chars). Returns the updated `TeacherOut`.

**Also update Supabase.** Login recreates a missing local profile from the Supabase user's
`school_name` metadata (see `routers/auth.py`). If only the local row changes, a recreated
profile would come back with the *old* school name. So the endpoint also calls Supabase
`PUT /auth/v1/user` with `{data: {school_name}}`, authorised with the teacher's own access
token — no admin key needed. Update Supabase first, then the local row.

**Frontend:** inline form with Save; on success update the auth context so the nav changes
immediately; toast "Saved". Spanish strings in `i18n/es/`.

## Delete account and all data

### What gets deleted

- **Local data:** deleting the `teachers` row cascades in Postgres to cohorts → students,
  rules, solutions, class assignments and share links (`ON DELETE CASCADE` on
  `cohorts.teacher_id` and below). One `DELETE`, one transaction.
- **The Supabase login account.** Without this the email stays registered: signing up
  again would fail with "already exists", and logging in would silently recreate an empty
  profile. Deleting it requires Supabase's admin API (`DELETE /auth/v1/admin/users/{id}`),
  i.e. the **service role key** — see Open questions. The Supabase user id is the `sub`
  claim of the access token.
- Then clear both auth cookies and send the teacher to a "Your account was deleted" page.

**Order:** Supabase account first, then local data. If Supabase fails, nothing is deleted
and the teacher sees an error. If the local delete then fails, the next login can't
happen anyway (account gone) — log it loudly; a retry endpoint isn't worth it at this scale.

### Guarding against accidents

Deletion is immediate and permanent (no grace period — nothing to restore from, and an
undeleted "deleted" account is a privacy liability). So the confirmation must be deliberate:

1. The danger-zone button opens a modal that states exactly what will go: "3 cohorts,
   94 students, 12 saved solutions and 2 share links" (counts from the API).
2. The teacher **re-enters their password**. The backend verifies it through Supabase's
   password grant before deleting. This also protects an unattended logged-in laptop and
   any cross-site request that rides on the session cookie.
3. Offer **"Download my data first"** in the same modal (see Open questions).

**Endpoint:** `DELETE /auth/me` with body `{password}` → `204`. Rate-limit it (e.g. 5/hour
per IP) since it accepts a password.

## Testing

- Backend unit: the Supabase outcomes for metadata update and admin delete (same pattern as
  `services/supabase_auth.py` + `tests/test_supabase_auth.py`).
- e2e: editing the school name (real), and the delete flow with **mocked** responses for the
  final call — the suite runs against the real teacher account, so it must never really
  delete it. A real end-to-end delete needs a throwaway account; add it to `docs/TODO.md`
  alongside the email-confirmation check.

## Open questions (need a decision before building)

1. **Service role key.** Deleting the Supabase account needs `SUPABASE_SERVICE_ROLE_KEY` in
   `backend/.env` (server only — never the frontend, never committed). Alternative without
   it: a `SECURITY DEFINER` Postgres function in Supabase that deletes the calling user,
   invoked over RPC with the teacher's token — no admin key in the app, but it's SQL that
   lives in the Supabase project rather than this repo. **Recommendation: service role key**
   — simpler, and the backend already holds other secrets.
2. **Data export before deletion.** Options: none; a ZIP of `.xlsx` class lists (reuses
   feature 09); or a full JSON/CSV export of students, rules and solutions. **Recommendation:
   one `.xlsx` workbook per cohort (students + latest class lists)** — teachers can open it,
   and it reuses the export code.
3. **Email and password changes** — out of scope here unless wanted. Password reset
   ("forgot password") is arguably more urgent than either and doesn't exist yet.
