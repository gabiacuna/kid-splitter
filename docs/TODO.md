# TODO

Things to do later that aren't planned features yet. Newest first.

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
