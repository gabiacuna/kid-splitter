# End-to-end tests

Playwright tests that drive the real app (frontend + backend + Postgres + Supabase auth).
They cover CSV import, gender editing, the constraint editor, the dashboard, solution
comparison, the class roster modal, `.xlsx` export and public share links.

## Prerequisites

1. **The stack is running** — Postgres, the backend on `http://localhost:8000`
   (`uv run uvicorn app.main:app --reload --port 8000` in `backend/`) and the frontend on
   `http://localhost:5173` (`npm run dev`). Override with `E2E_API_URL` / `E2E_APP_URL`.
2. **A teacher account** that can log in. Provide its credentials either as env vars
   `E2E_EMAIL` / `E2E_PASSWORD`, or in `frontend/e2e/.env` (gitignored):

   ```
   E2E_EMAIL=teacher@example.com
   E2E_PASSWORD=...
   ```

   `E2E_ENV_FILE=/path/to/file` points at a different file. Never commit credentials.
3. **Chromium for Playwright** — once: `npx playwright install chromium`.
   On Linux/WSL, Chromium also needs system libraries (`sudo npx playwright install-deps chromium`).
   Without sudo, unpack the missing `.deb`s locally (`apt-get download libnss3 libnspr4`,
   then `dpkg-deb -x <deb> <dir>`) and set `E2E_LD_LIBRARY_PATH=<dir>/usr/lib/x86_64-linux-gnu`.

## Running

```bash
cd frontend
npm run e2e                 # whole suite (~2–3 min)
npx playwright test roster  # one file
npm run e2e:report          # open the HTML report of the last run
```

Failures keep a screenshot and a trace in `e2e/.results/` (`npx playwright show-trace <zip>`).

## How it works

- `global.setup.ts` logs in once (session saved to `e2e/.auth/`, gitignored) and seeds three
  **pre-solved cohorts** that specs share via the `seed` fixture: full gender data (3 classes),
  partial gender data (3 classes) and no gender data (2 classes).
- **Solving is rate-limited to 10/hour per account**, and setup solves 3 times — so roughly
  three full runs per hour. Specs never solve on their own.
- Every cohort the suite creates is named `[e2e] …`; `global.teardown.ts` deletes all of
  them at the end (including leftovers from interrupted runs). Don't name real cohorts that way.
- Tests run serially (one worker) because they share one account.
- The `pageErrors` fixture fails any test that logs a page error or console error.
- `fixtures/school-export.csv` is **synthetic** (made-up names) but mirrors a real Chilean
  school export: surname-first `Nombre`, compound surnames, `Curso`/`N°` columns,
  `Preferencia N` columns with a typo, a non-existent student and a surname initial.
  Real student data must never be committed (`*.csv` is gitignored outside `fixtures/`).
