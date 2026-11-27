# TODO

Things to do later that aren't planned features yet. Newest first.

- [ ] **Configure the password-reset redirect in Supabase** (added 2026-11-24).
  "Forgot password" (`POST /auth/forgot-password` → `/reset-password`, see
  `docs/design-review/01-ui-pass.md`) sends Supabase's recovery email with
  `redirect_to=<FRONTEND_URL>/reset-password`. Supabase only honours redirect URLs on its
  allow-list, so in the dashboard go to **Authentication → URL Configuration → Redirect URLs**
  and add `http://localhost:5173/reset-password` and the production
  `<FRONTEND_URL>/reset-password`. Make sure `FRONTEND_URL` is set in the backend environment.
  Then check with a real account: the email arrives, the link opens the reset page (not the
  Site URL), the new password works, and an expired/used link shows "This link has expired".
  The Playwright tests only cover this flow with mocked responses.

- [ ] **Verify real account deletion and password change against Supabase** (added 2026-11-23).
  `POST /account/delete` and `POST /account/password` are mocked in the Playwright suite so the
  shared test teacher isn't mutated or deleted. Using a throwaway account (with
  `SUPABASE_SECRET_KEY` set in `backend/.env`), verify:
  - changing the password on `/profile` succeeds and the new password works on next sign-in
  - deleting the account removes both the Supabase user and local cohorts, and signing up again
    with the same email works cleanly.

- [ ] **Check the "Check your email" flow against real Supabase** (added 2026-11-23).
  The resend button (`POST /auth/resend-confirmation`, `ResendConfirmation.tsx`) is only
  tested with mocked responses, so no real email has gone through it. Sign up with a fresh
  address and check:
  - the confirmation email arrives (check spam), and the link activates the account
  - "Resend confirmation email" on the "Check your email" screen sends a second email
  - logging in before confirming shows "Confirm your email first" with the resend button
  - the rate-limit message shows up when Supabase's built-in mailer refuses (it only
    allows a few emails per hour per project). If that's too limiting, configure custom
    SMTP in Supabase or turn off "Confirm email" for development.
