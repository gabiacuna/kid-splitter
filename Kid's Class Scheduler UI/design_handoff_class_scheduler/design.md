# Kid Splitter — Design System

## Brand

**App name:** kid splitter  
**Audience:** Primary school teachers — non-technical, time-pressured  
**Tone:** Warm, approachable, confidence-inspiring. Not enterprise software.

---

## Typography

**Font:** [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) — a humanist geometric sans-serif with friendly proportions and strong weight range.

| Role | Weight | Size | Notes |
|---|---|---|---|
| Page heading | 800 | 24–26px | Letter-spacing −0.4px |
| Card title | 700 | 17–18px | Letter-spacing −0.2–0.3px |
| Score / big number | 800 | 28px | Accent color |
| Body / label | 500 | 13.5–14px | — |
| Meta / secondary | 500 | 12–13px | `--text3` color |
| Caps label | 700 | 11.5px | Uppercase, letter-spacing 0.5–0.6px |
| Nav brand | 800 | 17px | Letter-spacing −0.3px |

---

## Color Palette

All colors defined in OKLCH for perceptual consistency.

### Base

| Token | Value | Usage |
|---|---|---|
| `--bg` | `oklch(97% 0.012 85)` | Page background — warm off-white |
| `--bg2` | `oklch(94% 0.014 85)` | Subtle inset areas, empty states |
| `--card` | `#fff` | Card / nav surfaces |
| `--border` | `oklch(90% 0.012 85)` | Borders, dividers |

### Text

| Token | Value | Usage |
|---|---|---|
| `--text` | `oklch(22% 0.02 85)` | Primary text — warm near-black |
| `--text2` | `oklch(48% 0.02 85)` | Secondary text |
| `--text3` | `oklch(64% 0.015 85)` | Tertiary / placeholders |

### Accent — Teal (primary action)

| Token | Value | Usage |
|---|---|---|
| `--teal` | `oklch(56% 0.11 188)` | Primary buttons, active tabs, scores |
| `--teal-light` | `oklch(93% 0.06 188)` | Teal tinted backgrounds, chips |
| `--teal-dark` | `oklch(44% 0.11 188)` | Secondary button labels |

### Accent — Sage (secondary / positive)

| Token | Value | Usage |
|---|---|---|
| `--sage` | `oklch(60% 0.09 155)` | Active status badges, secondary scores |
| Sage bg | `oklch(93% 0.06 155)` | Sage chip backgrounds |

### Accent — Lavender (draft / tertiary)

| Token | Value | Usage |
|---|---|---|
| Lavender | `oklch(55% 0.1 270)` | Draft state, diversity card score |
| Lavender bg | `oklch(93% 0.05 270)` | Lavender chip backgrounds |

### Warning

| Token | Value | Usage |
|---|---|---|
| `--warn` | `oklch(88% 0.12 88)` | Warning banner background |
| `--warn-border` | `oklch(78% 0.14 75)` | Warning banner border |
| `--warn-text` | `oklch(38% 0.09 75)` | Warning banner text |

---

## Shadows

| Token | Value | Usage |
|---|---|---|
| `--shadow` | `0 2px 16px oklch(20% 0.02 85 / 0.08)` | Default card shadow |
| `--shadow-md` | `0 4px 24px oklch(20% 0.02 85 / 0.11)` | Elevated / best card shadow |
| Nav shadow | `0 1px 8px oklch(20% 0.02 85 / 0.05)` | Sticky nav underline |

---

## Border Radius

| Token | Value | Usage |
|---|---|---|
| `--r` | `14px` | Cards, large containers |
| `--r-sm` | `8px` | Buttons, inputs, small chips |
| Pill | `20px` | Status badges, type badges |
| Icon container | `9–10px` | Rounded icon squares |

---

## Components

### Nav
- Sticky, white background, `1.5px` warm border bottom
- Max content width `1100px`, `60px` tall
- Logo: `32×32px` teal rounded square with 2×2 grid icon
- Right: school name (`--text2`) + ghost logout button

### Cohort Card
- White card, `--r` radius, `--shadow`, `24px` padding
- Icon square (`40×40px`, `10px` radius) tinted to accent hue
- Status badge: pill, hue-matched to card accent
- Empty state: dashed `2px var(--border)` border, inset muted info block
- Full-width CTA button at bottom

### Tabs
- `2px solid var(--border)` bottom border on container
- Active tab: `2.5px solid var(--teal)` bottom, `--teal` text, weight 700
- Inactive: `--text3`, weight 600

### Constraint Row
- CSS grid: `1fr 1fr 110px 70px 120px 36px`
- White card, `--r-sm`, `--shadow`, `1.5px` border
- Contradiction: amber border `oklch(78% 0.14 75)`, warm tinted background
- Type badge: pill — Together = sage, Separate = coral `oklch(52% 0.12 25)`
- Trash icon: coral `oklch(60% 0.1 25)` on hover

### Solution Card
- Flex row (`flex:1`), stacks to column on mobile
- Best card: `2px solid var(--teal)` border, `--shadow-md`, top-right "✦ BEST" ribbon in teal
- Score: `28px / 800` weight numeral in accent color
- Stat chips: 2-up row, hue-matched backgrounds
- Bar chart: `10px` tall bars, `var(--bg2)` track, accent fill with opacity variation

### Buttons

| Variant | Background | Text | Border | Shadow |
|---|---|---|---|---|
| Primary | `--teal` | White | — | Teal glow `30%` |
| Secondary / ghost | `--bg2` | `--teal-dark` | `1.5px --border` | — |
| Outline | `none` | `--teal` | `2px dashed --border` | — |
| Nav logout | `none` | `--text3` | `1.5px --border` | — |

---

## Responsive Behaviour

- Content max-width: `1100px`, centered, `24px` side padding
- **Cohort grid:** `repeat(auto-fill, minmax(260px, 1fr))` → stacks to 1 column at `≤640px`
- **Solution cards:** horizontal flex → `flex-direction: column` at `≤640px`
- Breakpoint: `640px`

---

## Spacing Scale

Informal scale used throughout (no formal token names):

`4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 22 · 24 · 28 · 32 · 40 · 80px`

Cards: `24px` internal padding. Section headings: `32px` bottom margin. Page bottom: `80px` breathing room.
