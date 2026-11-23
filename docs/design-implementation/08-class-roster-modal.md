# 08 · Class roster modal + preference map

**Scope:** frontend · **Status:** new UI over existing data

Handoff section 4. Opened from "View class lists" on any solution card.

## Both surfaces are kept — decided

`App.tsx:31` routes `/solutions/:id` to `SolutionDetailPage` (263 lines), and `SolutionsTab.tsx:124` links to it. Critically, **that page is the only place sharing lives** — `shareEnabled`, `shareToken`, and `<ShareModal>` appear nowhere else (`SolutionDetailPage.tsx:152-253`).

The handoff never mentions sharing. Its three screens plus the roster modal have no share affordance at all. So replacing the page with the modal would silently orphan the entire share feature — `routers/share.py`, `PublicSharePage`, `ShareModal`, the token redaction rules — with no route left reaching it. That silence is almost certainly because the handoff covered three screens, not a judgement that sharing should go.

**Plan:** the modal is the fast path from the Solutions screen, as designed. The expanded modal carries a link through to `/solutions/:id`, which keeps share, deep links, and the existing page intact.

Extract the roster rendering into a shared component used by both — `ClassRoster` (`SolutionDetailPage.tsx:102`) is already close to the modal's compact view. Two surfaces rendering rosters is the one real cost here, and the shared component contains it.

## Compact view (default)

- Centered overlay, scrim `oklch(20% 0.02 85 / 0.45)`, click-outside closes. `.modal-overlay` / `.modal` classes already exist (`CohortDashboardPage.tsx`) — reuse them.
- White card, 14px radius, `--shadow-md`, max-width 520px, 28px padding, internal scroll.
- Header: `"{label} — class lists"` (19px/800), "Expand" pill (teal-light bg, teal-dark text, resize-corners icon), "✕" close.
- Body: per class, a `--bg2` block (8px radius, 14px/16px padding) with class name + count, then student names as teal pill chips (`--teal-light` bg, `--teal-dark` text, 20px radius).

## Expanded view

- Same modal widened to max-width 960px, max-height 88vh. "Collapse" returns to compact.
- Two columns (`flex; gap:22px`, wraps when narrow): roster table left, preference map right.
- Add the link through to the full solution page (share, permalink).

**Roster table:** section label + green "Download .xlsx" button (feature 09). Bordered container (1.5px `--border`, 8px radius), header row (`--bg2`) with Class / Student at `grid-template-columns: 1fr 1.4fr`, one row per student, top-border dividers, class name in its accent colour.

## Preference map

SVG, `viewBox="0 0 540 420"`:

- Connector lines between students who prefer to be together: `oklch(55% 0.02 85)`, 1.3px, 40% opacity.
- One filled circle per student, r=14, white 2px stroke, coloured by assigned class.
- Clusters arranged in a polygon, each cluster a circle of radius ~62 around its centre.
- Legend below: dot + class name per class, plus "— lines show paired preferences".

**Initials must be an HTML overlay, not SVG `<text>`.** The handoff is emphatic and explains why (a browser quirk where non-`<tspan>` markup inside `<text>` fails to paint). Absolutely-positioned `<div>`s over the SVG container, `left`/`top` as percentages (`node.x / 540 * 100`, `node.y / 420 * 100`), `transform: translate(-50%,-50%)`, white 10px/700.

Since we control the markup, plain text in `<text>` would in fact work — but follow the handoff. The overlay also makes initials selectable and easier to style, and there's no reason to relitigate it.

**Real data, not the sample.** The handoff is explicit: preference lines come from *"each cohort's actual 'Together' constraints, filtered to pairs where the students in question end up in the roster being viewed."* Both inputs are already available client-side — `class_assignments` from the solution, binary constraints from `GET /cohorts/{id}/constraints`. No new endpoint. Filter to `type === 'together'`.

Don't draw `separate` pairs — the design doesn't, and it risks visual noise.

## Layout must be parametric, not hardcoded to 3

The class cap is now 2–4 (see `10-class-count-cap.md`), which makes this tractable but not free. The design's triangle layout and three-colour palette assume exactly 3 classes.

- Arrange cluster centres on a polygon sized to `num_classes` — 2 (opposed), 3 (triangle), 4 (quad). Parametric, not three special cases.
- 4 classes needs a 4th node colour: coral, matching the class accent decision.
- **Cluster radius must scale with member count.** At radius 62, roughly 12 nodes is the limit before r=14 circles overlap. A 2-class split of a 30-student cohort puts 15 in each. Scale cluster radius up, or node radius down, with membership.
- Dense preference graphs produce a hairball. Acceptable — just confirm it doesn't hang.

## Interactions

- "View class lists" → compact. "Expand" → expanded. "Collapse" → compact. "✕" or scrim → closes and **resets to compact for next open**.
- Add what the design omits: `Esc` closes, focus trapped inside the modal, focus returns to the triggering button on close. Check whether the existing modals establish a pattern before writing new focus handling.

## Verification

- Open from each solution card → correct roster each time.
- Expand / collapse / close / reopen → reopens compact.
- Preference lines match the cohort's actual together-constraints. A constraint whose students landed in *different* classes still draws, crossing between clusters — that's the point of the visualisation.
- 2-class and 4-class cohorts → layout and palette both hold.
- A 2-class cohort with 30 students → nodes don't overlap.
- **Initials paint.** This is the specific thing the handoff warns about.
- Link through to `/solutions/:id` reaches the share controls.
