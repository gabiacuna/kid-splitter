# TODO

Things to do later that aren't planned features yet. Newest first.

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
