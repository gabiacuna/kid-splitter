# 05 · Constraint editor redesign

**Scope:** frontend · **Needs:** 04 · **Status:** redesign of existing screen

Reference: `screenshots/constraint-editor-contradiction.png` (Why? expanded). Target: `ConstraintEditorTab.tsx` (409 lines) + `index.css`.

## Autosave — decided

The design's grid is `1fr 1fr 110px 70px 120px 36px` — Student A | Student B | Type | Hard | Weight | delete. **There is no Save button and no column for one.** `ConstraintEditorTab.tsx:63` tracks `isDirty` and renders a per-row Save today; that goes away.

**Constraint edits autosave.** Two safeguards make this work rather than thrash:

1. **Debounce ~500ms on value-carrying fields.** A weight slider fires a change per pixel of drag; naive autosave turns one gesture into fifty `PUT`s. Revalidate contradictions **only after saves settle**, not per change, or the amber banner strobes while the teacher is still deciding.
2. **New rows stay client-side until complete.** A row with Student A chosen and Student B empty isn't persistable — the backend requires both. Hold it locally, save once both selects are filled, then autosave on every subsequent change. Note this means one row has two behaviours depending on completeness; it's the part most likely to feel janky if rushed.

Plus a page-level "saving… / saved" indicator. Autosave without feedback leaves people wondering.

Rationale for autosave over keeping explicit Save: a Save button on a row where you've just dragged a slider is a trap — teachers drag, watch the number change, and navigate away assuming it stuck. Autosave's failure mode is a wasted request; explicit-save's failure mode is silently losing work.

## Layout

**Grid.** Follow the design: `1fr 1fr 110px 70px 120px 36px`, 12px gap, column order **Student A | Student B | Type | Hard | Weight | (delete)**.

Current order is Student A | **Type** | Student B — type between the students, reading as prose: "Amara — Together — Ben". The design pulls type into its own badge column, which is worse as a sentence and better for scanning down a long list. Scanning is the actual task here, so the design wins. *(Assumed, not explicitly confirmed — worth a look at both in the browser before committing.)*

**Column header row.** Doesn't exist today. Uppercase 11.5px/700 labels, same grid template.

**Row styling.** White, 8px radius, card shadow, 1.5px border, 14px/16px padding, 10px between rows.

**Type badge.** Pill — Together = sage bg/text, Separate = coral. Rendering a `<select>` as a coloured pill needs either a styled native select (set a class from `c.type` so the background follows the value) or a two-button toggle. Prefer the styled select: keyboard- and screen-reader-native, and this is a form, not a filter.

**Add button.** "+ Add constraint" — full-width, 2px dashed border, teal text. Replaces the current top-right "+ Add binary".

**Delete.** Trash icon, coral on hover, replacing the `🗑` emoji. Move to the shared icon set (`frontend/public/icons.svg`). Keep the confirmation — the handoff agrees ("should prompt confirmation in production"). Under autosave, deletion is the one destructive action left, so its confirm matters more, not less.

## Weight scale: 1–5 → 1–10

The design specifies a 1–10 slider with a live value readout. `WeightSlider` renders `min={1} max={5}` with Low/High labels and no numeric display. The backend already accepts 0.1–10.0, so this is frontend-only.

**No data migration** — the product is undeployed, so there are no stored weights whose meaning would shift. Just change the range.

Add the live value readout; a slider with no readout on a 10-point scale is guesswork.

## Unary constraints — behind "Advanced"

The app has a full second constraint class (`small_class`, `large_class`, `max_flagged_peers`, `max_conflict_peers`) with its own row component, four endpoints, and working solver encoding. The design shows none of them.

**Keep them, collapsed behind an "Advanced" disclosure.** Teachers who never open it get exactly the screen in the mock; the capability stays reachable.

This resolves a genuine tension. `design.md` targets *"warm, approachable… not enterprise software"* for *"non-technical, time-pressured"* teachers — and `max_conflict_peers` is exactly the jargon that tone rules out. It's plausible the designer deliberately cut to the two concepts needing no explanation. But the solver encoding is done and tested, and deleting the only route to it converts finished work into dead code. The disclosure gets both without guessing at intent.

Restyle `UnaryRow` to the new visual language inside the collapsed section.

## Inline styles

Both row components carry substantial inline `style={{...}}` objects; the design has tokens for all of it. Move to classes in `index.css` alongside the existing `.constraint-row` rules **as you touch each element** — not as a separate sweep, which would make the diff unreviewable.

## Verification

Drive the real screen:

- Change a dropdown, tick Hard, drag the slider → each persists without a Save button; reload confirms.
- **Drag the weight slider across its full range → one `PUT`, not fifty.** Check the network tab.
- Add a new row, select only Student A, reload → nothing was persisted. Select both → it saves.
- Contradiction row renders amber border + warm tint + group badge, badge doesn't clip.
- Narrow to 640px — the 6-column grid needs a stacking rule; the design doesn't specify one, so pick something that keeps rows legible.
- "Advanced" collapsed by default; unary CRUD still works when expanded.
- Keyboard: tab through a row, change type and hard without a mouse.
