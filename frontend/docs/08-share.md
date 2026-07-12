# Feature: Share (Token Generation · Revocation · Public Read-Only View)

> Agent context: Teachers can share a solution with parents or colleagues via a public URL. The share link requires no login. It exposes only first names, class numbers, and allowlisted tags — never last names, teacher email, or sensitive tags. The token is a UUID v4 and is revocable. Revoked or nonexistent tokens return 404 with no indication that a token ever existed.

---

## Goal

Let teachers generate a shareable link for a solution and revoke it at any time. Recipients see a clean, read-only view of the class lists — no account required.

---

## Components

### `ShareButton` (`src/components/ShareButton.tsx`)

Appears on the `SolutionDetailPage` header.

**Props:**
```ts
interface ShareButtonProps {
  solutionId: string;
  shareEnabled: boolean;
  shareToken: string | null;
  shareBaseUrl: string;  // from env: VITE_API_URL or a separate VITE_SHARE_BASE_URL
}
```

**States:**

| State | Behavior |
|---|---|
| Not shared (`shareEnabled = false`) | Button: "Share" |
| Shared (`shareEnabled = true`) | Button: "Shared ✓" (or a different visual treatment to indicate active) |

Click → opens `ShareModal`.

---

### `ShareModal` (`src/components/ShareModal.tsx`)

**Props:**
```ts
interface ShareModalProps {
  solutionId: string;
  shareEnabled: boolean;
  shareToken: string | null;
  onClose: () => void;
  onShareStateChange: (shareEnabled: boolean, token: string | null) => void;
}
```

**Layout when not yet shared:**
- Heading: "Share this class list"
- Body: "Generate a link that anyone can use to view this class list. Recipients will see first names and class assignments only — no surnames or sensitive information."
- Button: "Generate link"

**Layout when shared:**
- Heading: "Share this class list"
- URL display: read-only text input, auto-selected on focus, containing the full share URL (`[SHARE_BASE_URL]/share/[token]`)
- "Copy link" button (copies to clipboard; button label changes to "Copied!" for 2s)
- Separator
- "Revoke link" button (danger styling)
- Note: "Revoking this link will immediately prevent anyone from accessing it."

**Generate link states:**

| State | Behavior |
|---|---|
| Idle | "Generate link" button enabled |
| Generating | Button: "Generating…", disabled |
| Success | Transition to "shared" layout; show the URL |
| Error | "Failed to generate link. Try again." |

**Revoke link states:**

| State | Behavior |
|---|---|
| Idle | "Revoke link" button enabled |
| Confirm | Inline confirmation replaces button: "Are you sure? [Revoke] [Cancel]" |
| Revoking | "Revoking…", disabled |
| Success | Transition to "not yet shared" layout; call `onShareStateChange(false, null)` |
| Error | "Failed to revoke. Try again." |

---

### `PublicSharePage` (`src/pages/PublicSharePage.tsx`)

Route: `/share/:token`

No authentication required. This page must be accessible without any JWT or cookie.

**On load:** `GET /share/:token`

**Page states:**

| State | Behavior |
|---|---|
| Loading | Centered spinner, no other content |
| Loaded | Render `PublicRosterView` |
| 404 (revoked or never existed) | Show: "This link is no longer available." No other details. |
| Server error | "Something went wrong. Try again later." |

---

### `PublicRosterView` (`src/components/PublicRosterView.tsx`)

**Props:**
```ts
interface PublicRosterViewProps {
  data: PublicSolutionData;
}

interface PublicSolutionData {
  cohort_name: string;         // shown as page heading
  classes: PublicClass[];
}

interface PublicClass {
  class_number: number;
  students: PublicStudent[];
}

interface PublicStudent {
  first_name: string;          // never last name
  tags: string[];              // allowlisted tags only; sensitive tags stripped by server
}
```

**Layout:**
- Page heading: "[Cohort name] — Class Lists"
- Subheading: "Shared view · Names only"
- One section per class: "Class [N]" heading + alphabetical list of first names
- If tags are present (allowlisted only): show as small pills next to the name
- No login prompt, no navigation header, no teacher-identifying information
- Minimal, clean layout — this may be printed or shown to parents

**Tags note:** The server strips sensitive tags. The frontend renders whatever tags the API returns — no client-side tag filtering needed.

---

## API Calls

| Action | Method + Path | Auth | Success | Error |
|---|---|---|---|---|
| Generate share token | `POST /solutions/{id}/share` | Required | 200 + `{ share_token, share_enabled: true }` | Toast error |
| Revoke share token | `DELETE /solutions/{id}/share` | Required | 200 + `{ share_enabled: false, share_token: null }` | Toast error |
| Get public solution | `GET /share/{token}` | None | 200 + `PublicSolutionData` | 404 → "no longer available" |

---

## Edge Cases

| Case | Handling |
|---|---|
| Token accessed after revocation | Server returns 404 → show "This link is no longer available." Do not distinguish between "never existed" and "revoked." |
| Teacher shares, then deletes the solution | Share token is cascade-deleted. Recipient gets 404. |
| Teacher opens share modal for an already-shared solution | Show the "shared" layout with the existing URL immediately (token is in the solution data). |
| "Copy link" in a browser that doesn't support `navigator.clipboard` | Fall back to selecting the URL text in the input. Show toast: "Copy the link above." |
| Public page on mobile | Must be readable at small screen sizes — this is likely viewed on phones. Single-column layout, large enough text. |
| Allowlist is empty (no tags approved for sharing) | Tags column simply doesn't appear. Do not show empty tag pills. |
| New tag created by teacher not yet on allowlist | Server strips it before returning public data. Frontend renders as-is. No client action needed. |

---

## Done When

- [ ] "Share" button on solution detail opens the modal
- [ ] Modal in "not shared" state shows the generate link button
- [ ] Generating a link shows the URL in a copyable input
- [ ] "Copy link" copies to clipboard and shows "Copied!" confirmation
- [ ] "Revoke link" requires inline confirmation before calling the API
- [ ] After revocation, modal returns to the "not shared" state
- [ ] Public page at `/share/:token` loads without authentication
- [ ] Public page shows only first names and class assignments
- [ ] Allowlisted tags appear on the public page; no sensitive tags appear
- [ ] Revoked or nonexistent token shows "This link is no longer available" with no other detail
- [ ] Public page is readable on mobile
