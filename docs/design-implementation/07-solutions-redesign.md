# 07 · Solutions comparison redesign

**Scope:** frontend · **Needs:** 03 · **Status:** redesign of existing screen

Reference: `screenshots/solutions-gender-balance.png`. Target: `SolutionsTab.tsx` (322 lines).

Much of this exists already — solution cards, BEST badge (line 86), class-size bars (line 111), "View class lists" (line 124). The substantive additions are the **gender balance section**, the **card subtitles**, and the **partial-data disclosure**.

## Already present, restyle only

- Card: white, 14px radius, 28px padding, flex column, 18px gap.
- Label (18px/800) + score row: 28px/800 accent number + "/ 100 score" (13px, `--text3`).
- Stat chips: two side by side, 10px gap, hue-tinted, 20px/800 numbers.
- Class sizes: caps label + rows of `label (48px) | bar (10px, --bg2 track, accent fill, 4px radius) | value`.
- BEST card: 2px teal border, `--shadow-md`, "✦ BEST" ribbon.
- Cards `flex:1` in a row, `flex-direction: column` at ≤640px.
- Helper caption below cards (12px, centered, `--text3`).

Check whether `components/SizeDistributionChart.tsx` already covers the class-size bars before writing new bar markup.

## New: card subtitles

Card labels are bare today (`balanced_sizes`). Each card gets a one-line subtitle saying what it optimises for.

This isn't cosmetic — it's the mitigation for a decision made in 03. Gender balance applies only to variants with `include_soft`, so **`balanced_sizes` will show visibly worse gender bars** than the other two even when the teacher ticked the balance box. Without a subtitle explaining that this card deliberately ignores preferences in favour of equal sizes, that reads as a bug. If it also wins on score, the teacher picks it and gets the thing they asked not to get.

**Copy — decided.** One line per variant, ≤ ~40 chars, plain-teacher language (no "soft constraint", no variant key):

| Variant | Subtitle |
|---|---|
| `balanced_sizes` | *Most equal class sizes — ignores preferences* |
| `soft_priority` | *Best honours your together/apart preferences* |
| `diversity_mix` | *Honours preferences, spreads flagged students* |

The dash-clause on `balanced_sizes` is load-bearing: it's the explicit warning that this card trades preferences (and therefore gender balance) for equal headcounts, so worse gender bars read as intended, not broken. Keep "ignores preferences" — softer phrasings ("prioritises sizes") don't tell the teacher they'll lose their together/apart rules if they pick it.

## New: boy/girl balance section

Below class sizes, same row pattern:

- Caps label "Boy / girl balance" (11.5px/700 uppercase).
- Per class: label + **segmented** bar (10px, 4px radius, teal = boys, sage = girls, proportional) + compact `"5B / 4G"` value (11px, right-aligned).
- Legend once below the whole card row, centered: teal "Boys", sage "Girls".

Data is `gender_split` from 03, which carries `unknown` alongside boys and girls. The design has no third segment because its sample data has no unknowns. Real data will — school exports only sometimes include gender.

**Unknown handling — decided:**

| Case | Behaviour |
|---|---|
| All students unknown | **Hide the whole section**, legend included. Bars of 0/0 are noise. |
| Some unknown | Render a third neutral segment (`--text3` low opacity or `--bg2`) so the bar still sums to class size, and include the count in the value label |

Silently dropping unknowns would make the bar lie about class size. The legend lists only the segments actually rendered.

## New: partial-data disclosure

When any student lacks a gender, a line under the bars states the count — *"16 of 28 students have no gender set"* — linking to the Students tab.

The reason this exists: solving is never blocked on incomplete gender data, and the *primary* prompt to fix it lives in the Students tab (see 01). But the design moves "Run solver" into the page header, visible on all three tabs, so a teacher can go Dashboard → Constraints → Run solver and never open Students. Without this line, the chart would quietly overstate what it knows — showing a tidy balance across the 12 students it has data for, while the teacher reads it as a claim about all 28.

It's a caption on a chart, not a second nag. One line.

## Score colouring

The design assigns teal 94 / sage 87 / lavender 81 — that's **rank order**, not score thresholds. Colour by index in the score-sorted list so a run where all three score 90+ still reads as ranked. Confirm the API returns them sorted; if not, sort client-side before assigning both accent and BEST badge.

With the class cap now 2–4 (see `10-class-count-cap.md`), a 4-class cohort needs a fourth bar colour — coral, pending the `dataviz` check noted there.

## "View class lists"

Currently a `<Link>` to `/solutions/:id` (line 124). Feature 08 changes it to open a modal. Leave the wiring alone here so this file stays a pure restyle.

## Verification

- Three solutions side by side; BEST is top-scoring.
- ≤640px → cards stack.
- Full gender data → bars proportional, values match class sizes.
- **No gender data → section and legend absent**, no empty bars, no disclosure line.
- Partial data → segments sum to class size, unknown count visible, disclosure line present and linking to Students.
- Ticking gender balance then solving → `balanced_sizes` shows worse bars than the other two, and its subtitle explains why.
