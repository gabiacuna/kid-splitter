# Handoff: Kid's Class Scheduler UI

## Overview
"kid s" is a web app that helps primary school teachers distribute students into balanced classes. This bundle covers three core screens: the cohort dashboard, the constraint editor, and the solution comparison view.

## About the Design Files
The files in this bundle (`Kid s.dc.html`, `support.js`) are **design references built in HTML** — prototypes showing the intended look, layout, and interaction behavior. They are not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, native, etc.) using its established component patterns, state management, and libraries. If no frontend environment exists yet, choose the most appropriate framework for the project and implement the designs there.

To view the reference: open `Kid s.dc.html` directly in a browser. It is a self-contained single-page app with in-memory screen switching (no real routing/backend — all data is hardcoded sample content).

## Fidelity
**High-fidelity.** Colors, typography, spacing, border radii, and shadows are final. Recreate pixel-perfectly using exact values in the Design Tokens section below.

## Design System
See `design.md` in this folder for the full token reference (colors, type scale, shadows, radii, spacing). Summary below.

### Typography
Font: **Plus Jakarta Sans** (Google Fonts), weights 400–800.

| Role | Weight | Size |
|---|---|---|
| Page heading | 800 | 24–26px |
| Card title | 700 | 17–18px |
| Score / big number | 800 | 28px |
| Body / label | 500 | 13.5–14px |
| Meta / secondary | 500 | 12–13px |
| Caps label | 700 | 11.5px, uppercase, letter-spacing 0.5–0.6px |
| Nav brand | 800 | 17px |

### Colors (OKLCH)
- `--bg: oklch(97% 0.012 85)` — page background, warm off-white
- `--bg2: oklch(94% 0.014 85)` — inset/empty-state areas
- `--card: #fff`
- `--border: oklch(90% 0.012 85)`
- `--text: oklch(22% 0.02 85)` / `--text2: oklch(48% 0.02 85)` / `--text3: oklch(64% 0.015 85)`
- Teal (primary accent): `--teal: oklch(56% 0.11 188)`, `--teal-light: oklch(93% 0.06 188)`, `--teal-dark: oklch(44% 0.11 188)`
- Sage (secondary/positive): `oklch(60% 0.09 155)`, bg `oklch(93% 0.06 155)`
- Lavender (draft/tertiary): `oklch(55% 0.1 270)`, bg `oklch(93% 0.05 270)`
- Coral (separate/delete): `oklch(52% 0.12 25)` text, `oklch(60% 0.1 25)` icon
- Warning: bg `oklch(88% 0.12 88)`, border `oklch(78% 0.14 75)`, text `oklch(38% 0.09 75)`

### Shadows & Radii
- Card shadow: `0 2px 16px oklch(20% 0.02 85 / 0.08)`
- Elevated/"best" shadow: `0 4px 24px oklch(20% 0.02 85 / 0.11)`
- Card radius: `14px`; button/input/chip radius: `8px`; pill badges: `20px`; icon squares: `9–10px`

## Screens

### 1. Cohort Dashboard (`/cohorts`)
**Purpose:** Home screen — teacher picks a cohort to manage.

**Layout:**
- Sticky top nav, `60px` tall, white bg, `1.5px` bottom border, max-width `1100px` centered.
  - Left: 32×32px teal rounded-square logo (2×2 grid icon) + "kid s" wordmark (800 weight, 17px).
  - Right: school name text (`--text2`) + ghost "Log out" button (`1.5px` border, `8px` radius).
- Page container: max-width `1100px`, `40px 24px 80px` padding.
- Header row: "Your cohorts" H1 (26px/800) + subtitle, with primary "New cohort" button (teal, `+` icon) right-aligned. `flex; justify-content: space-between`, wraps on narrow widths.
- Card grid: CSS Grid `repeat(auto-fill, minmax(260px, 1fr))`, `18px` gap. **Stacks to 1 column at ≤640px.**

**Cohort card** (white, 14px radius, card shadow, 24px padding, flex column, 14px gap):
- Top row: 40×40px icon square (10px radius, hue-tinted bg per card) + status pill badge ("Active" sage, "Draft" lavender) top-right.
- Cohort name (17px/700) + "N students · N classes" (13px, `--text3`).
- "Last solved X ago" line (12.5px, `--text3`, bold value in `--text2`).
- Full-width "Open →" button (teal bg/white text primary style).

**Empty-state card:** dashed 2px border instead of shadow border, muted inset block reading "No solves yet — Add constraints and run your first solve", ghost-style "Open →" button.

Sample cards: "4th Grade 2026" (28 students, Active, solved 2 days ago), "3rd Grade 2026" (24 students, Active, 1 week ago), "5th Grade 2026" (31 students, Draft, 3 weeks ago), "2nd Grade 2026" (18 students, empty state).

### 2. Constraint Editor (`/cohorts/:id?tab=constraints`)
**Purpose:** Define pairing rules between students before solving.

**Layout:**
- Breadcrumb: "← All cohorts / 4th Grade 2026" (13px).
- Header: cohort name (24px/800) + meta, "Run solver ✦" primary button right-aligned.
- Tab bar: Students | Constraints | Solutions — bottom-border style, `2px solid var(--border)` container, active tab `2.5px solid teal` + teal text/700 weight, inactive `--text3`/600 weight. **Constraints tab is active.**
- Warning banner (full width, directly below tabs): warm amber bg (`--warn`), `1.5px` border (`--warn-border`), triangle-alert icon, text: "1 contradiction found — resolve before solving." (13.5px/600, `--warn-text`).
- Column header row: Student A | Student B | Type | Hard | Weight | (blank for delete), CSS grid `1fr 1fr 110px 70px 120px 36px`, 12px gap, uppercase 11.5px labels.
- Constraint rows: same grid template, white bg, 8px radius, card shadow, 1.5px border, 14px/16px padding, 10px gap between rows.
  - Two `<select>` dropdowns for student pairing.
  - Type badge pill: "Together" = sage bg/text, "Separate" = coral bg/text.
  - Centered checkbox for "Hard" constraint.
  - Range slider (1–10) for weight.
  - Trash icon button (coral on hover).
  - **Contradiction row is visually distinct:** amber border (`oklch(78% 0.14 75)`) + warm tinted background (`oklch(97% 0.04 85)`) instead of default white/gray border.
- "+ Add constraint" ghost button below rows: dashed 2px border, teal text, full width.

Sample rows: Amara O. ↔ Ben K. (Together, Hard, weight 8, **contradiction**), Chloe R. ↔ Daniel S. (Separate, weight 5), Emma T. ↔ Fiona L. (Together, Hard, weight 9), George P. ↔ Amara O. (Separate, weight 3).

### 3. Solution Comparison (`/cohorts/:id?tab=solutions`)
**Purpose:** Compare solver outputs and pick one to finalize.

**Layout:**
- Same breadcrumb/header/tab pattern as Constraints screen, with Solutions tab active and "Re-run solver ✦" button.
- Subtitle line: "Here are 3 ways to split your students. Pick the one that feels right for your class." (14px, `--text3`).
- Solution cards: flex row, `18px` gap, equal flex-basis (`flex:1`). **On mobile (≤640px), switches to `flex-direction: column`** (cards stack).

**Solution card** (white, 14px radius, 28px padding, flex column, 18px gap):
- Label (18px/800) + score row: big number (28px/800, accent-colored) + "/ 100 score" (13px, `--text3`).
- Two stat chips side by side (flex, 10px gap): "Soft violations" and "Hard violations", each hue-tinted bg, 20px/800 number.
- Bar chart section: "Class sizes" caps label (11.5px/700 uppercase), then 3 rows — class label (12px/600, 48px wide) + horizontal bar (10px tall, `--bg2` track, accent fill, rounded 4px, width % proportional to size) + numeric value (12px).
- Full-width "View class lists" button at bottom (`margin-top: auto` to pin to card bottom).

**Card 1 — "Balanced sizes" (BEST):** `2px solid teal` border, elevated shadow, teal "✦ BEST" ribbon badge top-right corner. Score 94, soft violations 2, hard violations 0. Class sizes: 10/9/9. Primary teal "View class lists" button.

**Card 2 — "Soft priority":** default border/shadow. Score 87 (sage), soft violations 4, hard 0. Class sizes: 11/8/9. Ghost-style button.

**Card 3 — "Diversity mix":** default border/shadow. Score 81 (lavender), soft violations 6, hard 0. Class sizes: 12/7/9. Ghost-style button.

Small helper caption below cards (12px, centered, `--text3`): "On a small screen? Cards stack so you can compare one at a time."

## Interactions & Behavior
- Nav logo click → navigate to Cohort Dashboard.
- Dashboard "Open →" / "New cohort" → navigate to Constraint Editor (new cohorts should probably land on Students tab first in production — the prototype simplifies this to Constraints).
- Tab clicks switch between Students / Constraints / Solutions views for the same cohort (URL-driven via `?tab=` query param in production).
- Breadcrumb "← All cohorts" → back to Dashboard.
- Constraint row: dropdowns select students; checkbox toggles hard/soft; slider adjusts weight 1–10 (live value display); trash icon deletes the row (should prompt confirmation in production).
- Solution card "View class lists" → should open a detailed roster view per class (not included in this bundle — scope for next screen).
- No animations beyond standard hover/opacity transitions on buttons; keep transitions subtle (150–200ms).

## State Management (suggested)
- `currentScreen`: 'dashboard' | 'constraints' | 'solutions' (or real route state)
- `selectedCohortId`
- Per-cohort: `students[]`, `constraints[]` (each with studentA, studentB, type: 'together'|'separate', isHard: bool, weight: 1-10), `solutions[]` (each with label, score, softViolations, hardViolations, classSizes[])
- Constraint contradiction detection: flag any constraint set that is logically unsatisfiable (e.g. A-together-B AND A-separate-B), surface via the warning banner + row highlight — this logic should be computed, not hardcoded per the prototype.

## 4. Class Roster Modal (opened from "View class lists" on any Solution card)
**Purpose:** Let a teacher inspect and export the actual class lists behind a given solution, and see a preference relationship map.

**Compact view (default on open):**
- Centered modal overlay, dim scrim (`oklch(20% 0.02 85 / 0.45)`) behind, click-outside-to-close.
- White card, 14px radius, elevated shadow, max-width 520px, 28px padding, scrolls internally if tall.
- Header: solution label + "— class lists" (19px/800), "Expand" pill button (teal-light bg, teal-dark text, small resize-corners icon) + "✕" close button, top-right.
- Body: one block per class (muted `--bg2` bg, 8px radius, 14px/16px padding) showing class name + student count, then student names as small teal pill chips (`--teal-light` bg, `--teal-dark` text, 20px radius).

**Expanded view (triggered by "Expand"):**
- Same modal, widens to max-width 960px, max-height 88vh.
- Header adds a "Collapse" button (returns to compact) alongside close.
- Two-column layout (`flex; gap:22px`, wraps to stacked on narrow width): **Roster table** on the left, **Preference map** graph on the right.

**Roster table:**
- Section label "Roster table" (uppercase, 11.5px/700) + a green **"Download .xlsx"** button (`oklch(52% 0.13 148)` bg, white text/icon, small spreadsheet glyph icon, 8px radius) top-right of the section.
- Table: bordered container (1.5px `--border`, 8px radius), header row (`--bg2` bg) with "Class" / "Student" columns (`grid-template-columns: 1fr 1.4fr`), then one row per student, top border divider, class name colored to match its class's accent (teal/sage/lavender), student name in default text color.
- **Download behavior:** generates a CSV of all rows (`Class,Student` header) as a `Blob` (`type: application/vnd.ms-excel`), triggers a browser download named `<solution-label>-class-list.xls`. This opens correctly in Excel; it is not a true binary `.xlsx` — for production, generate a real `.xlsx` via a library (e.g. SheetJS/`xlsx` on the client, or a server-side export endpoint) using the same column structure.

**Preference map (graph visualization):**
- Section label "Preference map" (uppercase, 11.5px/700).
- Container: bordered, 8px radius, muted `--bg2` background, `position: relative`.
- An SVG (viewBox `0 0 540 420`) draws: thin gray connector lines (`oklch(55% 0.02 85)`, 1.3px, 40% opacity) between paired students who prefer to be together, and a filled circle node (r=14, white 2px stroke) per student, colored by their assigned class (teal / sage / lavender — same three accent hues used elsewhere).
- **Node initials are NOT rendered inside the SVG `<text>`** — they're an absolutely-positioned HTML `<div>` overlay on top of the SVG container, one per node, positioned via `left/top` percentages (node x/y ÷ viewBox width/height × 100) with `transform: translate(-50%,-50%)`, showing the student's initials in white 10px/700 text. (This avoids a known browser quirk where non-`<tspan>` markup injected inside SVG `<text>` fails to paint — keep initials as an HTML overlay, not SVG text content, in the production version too.)
- Layout: students are clustered by class into 3 groups arranged in a triangle within the viewBox, each cluster arranged in a small circle (radius 62) around its center point.
- Legend row below the graph: one dot + class name per class, plus a caption "— lines show paired preferences".

**Sample/placeholder data:** All three solutions draw from the same ~28-name student pool, redistributed differently into 3 classes per solution. Preference-line data is a fixed sample list of "together" pairs (e.g. Amara O. ↔ Ben K., Emma T. ↔ Fiona L.) — in production this should be sourced from each cohort's actual "Together" constraints (see Constraint Editor screen), filtered to pairs where the students in question end up in the roster being viewed.

## Interactions & Behavior — Roster Modal
- Any "View class lists" button → opens modal in compact view for that solution.
- "Expand" → switches modal to the wider table+graph view (same modal, no navigation).
- "Collapse" → returns to compact view.
- "✕" or click on the scrim (outside the white card) → closes modal entirely, resets to compact for next open.
- "Download .xlsx" → triggers the CSV-as-.xls download described above; no confirmation dialog needed.

## Assets
No external images. Inline SVG logo mark (2×2 grid, teal), inline SVG icons (people/cohort icon, warning triangle, trash, plus, expand/resize-corners, spreadsheet/download glyph). Font loaded via Google Fonts CDN (`Plus Jakarta Sans`).

## Files
- `Kid s.dc.html` — full HTML reference for all screens and the roster modal (screen/modal state switching via local component state)
- `design.md` — complete design token reference
- `support.js` — internal runtime shim for the prototype tool; **not needed** in the production implementation, ignore it
