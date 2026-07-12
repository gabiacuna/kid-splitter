# Feature: Auth (Register · Login · Session)

> Agent context: The handoff doc covers the full JWT flow (Supabase, httpOnly cookies, 1hr access token + 7d refresh). This file is the frontend implementation spec only.

---

## Goal

Allow a teacher to create an account or sign in. After authentication, persist the session across page refreshes without re-prompting for credentials. Redirect unauthenticated users to `/login` from any protected route.

---

## Components

### `AuthContext` (`src/context/AuthContext.tsx`)

Global context. Wrap the entire app in this provider.

**Shape:**
```ts
interface AuthContextValue {
  teacher: Teacher | null;   // null = not authenticated or loading
  isLoading: boolean;        // true while /auth/me is in flight on mount
  logout: () => Promise<void>;
}

interface Teacher {
  id: string;
  email: string;
  school_name: string;
}
```

**Behavior:**
- On mount, call `GET /auth/me`. If 200 → set `teacher`. If 401 → set `teacher = null`.
- `logout()` calls `POST /auth/logout`, then sets `teacher = null` and navigates to `/login`.
- Expose via `useAuth()` hook in `src/hooks/useAuth.ts`.

---

### `LoginPage` (`src/pages/LoginPage.tsx`)

Route: `/login`

**Fields:**
- Email (type=email, required)
- Password (type=password, required)
- Submit button: label "Sign in"

**States:**

| State | Behavior |
|---|---|
| Idle | Form enabled, no errors shown |
| Submitting | Button shows "Signing in…", all inputs disabled |
| Error — invalid credentials | Inline error below password: "Incorrect email or password." |
| Error — network/server | Inline error: "Something went wrong. Try again." |
| Success | Navigate to `/cohorts` |

**Notes:**
- No "remember me" toggle — session persistence is handled by the refresh token automatically.
- Do not expose whether the email exists (use generic error for both wrong email and wrong password).
- Show a link to `/register`: "Don't have an account? Sign up"

---

### `RegisterPage` (`src/pages/RegisterPage.tsx`)

Route: `/register`

**Fields:**
- School name (text, required, max 100 chars)
- Email (type=email, required)
- Password (type=password, required, min 8 chars)
- Confirm password (type=password, required)
- Submit button: label "Create account"

**States:**

| State | Behavior |
|---|---|
| Idle | Form enabled |
| Client validation error | Shown inline per field on blur, not on submit |
| Submitting | Button shows "Creating account…", inputs disabled |
| Error — email already exists | Inline below email: "An account with this email already exists." |
| Error — server | Inline: "Something went wrong. Try again." |
| Success | Show confirmation message: "Check your email to confirm your account." Do not auto-login yet. |

**Validation (client-side, before submit):**
- Password must be ≥ 8 characters
- Confirm password must match password
- Email must be valid format

**Notes:**
- Show a link back to `/login`: "Already have an account? Sign in"

---

### `ProtectedRoute` (`src/components/ProtectedRoute.tsx`)

Wraps all authenticated routes.

**Behavior:**
- While `isLoading` is true: render a full-page centered spinner.
- If `teacher === null` (after loading completes): redirect to `/login`.
- Otherwise: render children.

---

## API Calls

| Action | Method + Path | Request body | Success | Error |
|---|---|---|---|---|
| Check session on mount | `GET /auth/me` | — | 200 + `Teacher` object | 401 → treat as logged out |
| Login | `POST /auth/login` | `{ email, password }` | 200 + `Teacher` | 401 → invalid credentials |
| Register | `POST /auth/register` | `{ email, password, school_name }` | 201 | 409 → email taken |
| Logout | `POST /auth/logout` | — | 200 | Any error → still clear local state |

Cookies are set by the server (`httpOnly`). The frontend does not touch them directly.

---

## Edge Cases

| Case | Handling |
|---|---|
| User navigates to `/login` while already authenticated | Redirect to `/cohorts` |
| Access token expires mid-session | Axios interceptor catches 401, calls `POST /auth/refresh`, retries original request once. If refresh also fails, call `logout()`. |
| `/auth/me` is slow on mount | Show full-page spinner; do not flash the login page before the check completes |
| Back button after logout | Protected routes re-check auth; redirect to `/login` |

---

## Done When

- [ ] Teacher can register with a new email and sees the confirmation prompt
- [ ] Teacher can log in and is taken to `/cohorts`
- [ ] Refreshing any protected page does not log the teacher out
- [ ] Navigating to `/login` while authenticated redirects to `/cohorts`
- [ ] Any protected route navigated to while logged out redirects to `/login`
- [ ] Logout clears session and redirects to `/login`
- [ ] Two teachers cannot see each other's data (enforced by API, but verify in E2E)
