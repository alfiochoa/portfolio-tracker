# Design system

How portfolio-tracker looks: **Glance**, with a **Desk** view one tab away (Alfredo, 2026-11-05; `docs/DECISIONS.md`). The designer keeps this file. Builders read the general sections once per task ("Rules that bind design", "Tokens", "Type", "Spacing and layout", "Views") and then only the `###` section of what they touch: `grep -n '^##' docs/DESIGN.md` lists them. Each `###` describes the thing as it is meant to be now; history lives in the task files and `docs/DECISIONS.md`.

The reference pictures are D-001's mock-ups (`$TEAM_DIR/design/D-001/glance/` and `desk/`) and D-002's (`$TEAM_DIR/design/D-002/`: the header with the view control, the full-width performance card, the euro total). Where this file and a picture disagree, this file wins.

## Rules that bind design

1. **A return always shows its sign**: `+1.23 %`, `−0.45 %` (U+2212, never a hyphen), `0.00 %` with none. A euro change likewise (`+1 234 €`, `−48 €`, `0 €`); a euro value never (`25 312 €`).
2. **Colour is never the only signal.** Up and down are also the sign; a freshness state is also its word (`FRESH`, `STALE`, `PARTIAL`, `ERROR`); a tint is also the number in it.
3. **Figures are tabular** (`font-variant-numeric: tabular-nums`), except the one big 1-day number in Glance, and never wrap (`white-space: nowrap`): a no-break space (U+00A0) before `%` and `€`, a narrow no-break space (U+202F) between thousands.
4. **Up is `--up`, down is `--down`, `0.00 %` is `--muted`.** No other colour on a number. Glance's up/down are blue/orange; Desk's are green/red. A tint (`--up-tint`, `--down-tint`) shows the size of a move and goes only behind a return, never behind a weight or a euro value.
5. **Targets are at least 44 × 44 px** (`--hit`) as hit area: the view control, the badge, a fund's name, every button and link, the chart.
6. **Both themes of both views are designed.** Tokens only: no literal colour, size or font in a component. Text is at least 4.5:1 against its background, marks (bars, swatches, lines) at least 3:1, in all four sets.
7. **Nothing is fixed or sticky**, so nothing hides under a bar.
8. **No third-party request from the page.** Fonts are self-hosted from `public/fonts/`.
9. **Quiet.** One accent per view, no gradients, no shadow beyond the card's edge, no animation beyond a hover or press change of at most 120 ms (none under `prefers-reduced-motion`).
10. **Copy** is English, sentence case, dates ISO (`2026-11-03`), times `2026-11-04 08:10 UTC`. A section with nothing to show says why in a sentence, never a bare dash or a blank.

## Tokens

All tokens are CSS variables on `:root` in `src/styles.css`. Names reuse what the stylesheet had before this direction wherever the role existed (`--bg`, `--surface`, `--fg`, `--muted`, `--line`, `--accent`, `--up`, `--down`, `--ok`, `--warn`, `--error`, `--focus`, `--space-*`, `--hit`, …); "Changes from main's tokens" at the end lists what is new, renamed or retired.

### Colour

| Token | Role | Glance light | Glance dark | Desk light | Desk dark |
|---|---|---|---|---|---|
| `--bg` | page | `#f2f2ee` | `#0e1013` | `#e9edf2` | `#0b0e13` |
| `--surface` | card, badge, input group | `#ffffff` | `#171a1f` | `#ffffff` | `#11161d` |
| `--surface-2` | inset: a flat cell, a track, a section's head bar (Desk), a hovered row | `#f2f2ee` | `#0e1013` | `#f3f5f8` | `#161d27` |
| `--fg` | text | `#14161a` | `#eef0f3` | `#151c26` | `#d7dde6` |
| `--muted` | secondary text, `0.00 %`, axis labels | `#596069` | `#9ba3ad` | `#566173` | `#8793a4` |
| `--muted-on-tint` | a window's label inside a tinted cell | `#4b525b` | `#adb4be` | `#566173` | `#8793a4` |
| `--line` | hairlines, gridlines, the card's edge | `#e2e3de` | `#2a2f36` | `#d3d9e1` | `#222b37` |
| `--accent` | the one interactive colour: the chosen view, primary button, link (Desk), chart line, end dot | `#14161a` | `#eef0f3` | `#1d6ccf` | `#4aa3ff` |
| `--on-accent` | text on `--accent` | `#ffffff` | `#171a1f` | `#ffffff` | `#04121f` |
| `--link` | a link's text | `#14161a` | `#eef0f3` | `#1d6ccf` | `#4aa3ff` |
| `--focus` | focus ring | `#14161a` | `#eef0f3` | `#1d6ccf` | `#4aa3ff` |
| `--up` | a gain, as text | `#1952ad` | `#8ab6ff` | `#0a7647` | `#2ec78a` |
| `--down` | a loss, as text | `#9a3d08` | `#ffa66b` | `#c1302a` | `#f2645f` |
| `--up-tint` | rgb of a gain's cell tint | `37 99 235` | `96 150 255` | `37 99 235` | `96 150 255` |
| `--down-tint` | rgb of a loss's cell tint | `234 108 26` | `255 140 70` | `234 108 26` | `255 140 70` |
| `--tint-strength` | multiplies every tint (Desk has none) | `1` | `1` | `0` | `0` |
| `--ok` | `FRESH` | `#1a7f45` | `#6fd49a` | `#0a7647` | `#2ec78a` |
| `--warn` | `STALE`, `PARTIAL`, a run that was not ok | `#8a5a00` | `#f1c063` | `#8f5b00` | `#f5b94a` |
| `--error` | `ERROR`, an invalid input | `#b3261e` | `#ff8a80` | `#c1302a` | `#f2645f` |
| `--warn-bg` | behind a warning (badge detail, notice) | `#fbf1db` | `#2c2414` | `#f7f4ed` | `#232321` |
| `--error-bg` | behind an error | `#fbe9e7` | `#2e1716` | `#fbf3f2` | `#231c22` |
| `--equity` | equities in the allocation | `#2e3a4a` | `#c9d3e0` | `#1d6ccf` | `#4aa3ff` |
| `--bond` | bonds in the allocation | `#2f8f86` | `#4fb3a9` | `#7a4fd6` | `#b58cff` |
| `--area` | the chart's fill between the line and 100 | `rgb(20 22 26 / 0.06)` | `rgb(238 240 243 / 0.06)` | `rgb(29 108 207 / 0.08)` | `rgb(74 163 255 / 0.10)` |
| `--spark-up` / `--spark-down` / `--spark-flat` | a sparkline's line by its 2m sign | `--muted` ×3 | `--muted` ×3 | `--up` / `--down` / `--muted` | `--up` / `--down` / `--muted` |
| `--spark-end` | a sparkline's end dot | `--fg` | `--fg` | `currentColor` (its line) | `currentColor` |
| `--tag-bg` / `--tag-ink` | the chart's end label | `transparent` / `--fg` | `transparent` / `--fg` | `--accent` / `--on-accent` | `--accent` / `--on-accent` |
| `--card-edge` | the card's `box-shadow` | `0 1px 2px rgb(20 22 26 / 0.06), 0 0 0 1px var(--line)` | `0 0 0 1px var(--line)` | `0 0 0 1px var(--line)` | `0 0 0 1px var(--line)` |
| `--chrome-rule` | the rule under the header and over the footer | `transparent` | `transparent` | `var(--line)` | `var(--line)` |

**A tint** is `rgb(var(--up-tint) / calc(var(--heat) * var(--tint-strength)))` (or `--down-tint`), where `--heat` is set on the cell by the renderer: `0.07 + 0.18 × min(1, |return| / cap)`, the cap being 1 % for 1d, 2.5 % for 5d and 1w, 5 % for 1m, 7 % for 2m. `0.00 %` and "not enough history" have no tint: their cell is `--surface-2`.

**Contrast** (WCAG ratio; D-001's README has the base table, `$TEAM_DIR/design/D-001/source/contrast.py` recomputes it). Body, muted, up, down, ok, warn and error text are at least 4.5 on every surface in all four sets. Added here: up/down on the strongest tint 5.1–5.7; `--muted-on-tint` on the strongest tint 5.3–6.0 (`--muted` there would be 4.3–4.8, which is why the role exists); warn on `--warn-bg` 5.2–9.1 and error on `--error-bg` 5.2–7.4; `--on-accent` on `--accent` 18.1 / 15.3 (Glance), 5.1 / 7.2 (Desk); `--equity` and `--bond` as marks on `--surface` 3.9 (Glance light bond, the lowest) to 11.5.

### Switching the sets

Four blocks, in this order (equal specificity, so the order decides):

```css
:root { /* Glance light, and every shared token */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { /* Glance dark */ } }
:root[data-theme='dark'] { /* Glance dark again */ }
:root[data-view='desk'] { /* Desk light: colour, type and shape tokens */ }
@media (prefers-color-scheme: dark) { :root[data-view='desk']:not([data-theme='light']) { /* Desk dark */ } }
:root[data-view='desk'][data-theme='dark'] { /* Desk dark again */ }
```

Both views follow the system's light or dark setting; `data-theme` is the override the stylesheet already has (no toggle on the page for now). `color-scheme` is set in each block so form controls and scrollbars follow.

### Shape and size

| Token | Role | Glance | Desk |
|---|---|---|---|
| `--hit` | smallest target | `44px` | `44px` |
| `--radius-card` | a section's card | `18px` (`16px` ≤ 40rem) | `6px` |
| `--radius-cell` | a tinted cell or tile | `10px` (`8px` in the table) | `0` |
| `--radius` | badge detail, notice, input, placeholder | `12px` | `4px` |
| `--radius-badge` | the badge | `999px` | `12px` |
| `--radius-control` | view control, buttons | `999px` | `4px` |
| `--head-bg` / `--head-pad` / `--head-rule` / `--head-bleed` | a section's head ("Card and section head") | `transparent` / `0` / `none` / `0` | `var(--surface-2)` / `5px 9px` / `1px solid var(--line)` / `1` |
| `--border` | a hairline | `1px` | `1px` |
| `--focus-ring` | ring width and offset | `2px` | `2px` |
| `--line-weight` | the chart's line | `2.25px` | `1.75px` |
| `--spark-weight` | a sparkline | `1.5px` | `1.4px` |
| `--bar-thick` | the equities/bonds bar | `12px` | `10px` |
| `--track` | an asset class's track | `4px` | `4px` |
| `--swatch` | a legend swatch, the badge dot | `10px` | `8px` |

## Type

### Fonts

| View | Text | Numbers | Files |
|---|---|---|---|
| Glance | Manrope (variable, 200–800; 400–700 used) | Manrope with tabular figures | `public/fonts/manrope-latin.woff2` (24 KB) |
| Desk | IBM Plex Sans (variable, 100–700; 400–600 used) | IBM Plex Mono 400, 500, 600 | `public/fonts/ibm-plex-sans-latin.woff2` (40 KB), `ibm-plex-mono-latin-{400,500,600}.woff2` (10 KB each) |

Latin subsets (Google Fonts' `latin` range), under the SIL Open Font License 1.1; the licences are beside them (`public/fonts/OFL-Manrope.txt`, `OFL-IBM-Plex.txt`). They are declared at the top of `src/styles.css`:

```css
@font-face { font-family: 'Manrope'; src: url('/fonts/manrope-latin.woff2') format('woff2');
  font-weight: 200 800; font-style: normal; font-display: swap; }
@font-face { font-family: 'IBM Plex Sans'; src: url('/fonts/ibm-plex-sans-latin.woff2') format('woff2');
  font-weight: 100 700; font-style: normal; font-display: swap; }
@font-face { font-family: 'IBM Plex Mono'; src: url('/fonts/ibm-plex-mono-latin-400.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: swap; }
/* …and 500, 600 the same way */
```

Vite rewrites `/fonts/…` in the CSS to a relative URL (`../fonts/…`), so the build works under Pages' sub-path (checked in D-002). A browser downloads a face only when text uses it, so Glance never fetches Plex and Desk never fetches Manrope. No `<link>` to any font service. **The thousands space.** The subsets have no U+202F, and the system's fallback glyph next to Manrope is a hairline, so `10 084 €` read as `10084€`. `manrope-latin.woff2` is therefore a modified version: U+202F is mapped to Manrope's own space glyph (0.2 em, narrow already), nothing else changed (Manrope has no Reserved Font Name, so the modified file keeps its name under the same licence; `public/fonts/README.md` says so). The Plex files are unmodified (Plex's name is reserved); in Desk the fallback space reads well enough in a monospaced column.

| Token | Glance | Desk |
|---|---|---|
| `--font` | `'Manrope', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | `'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` |
| `--font-num` | `var(--font)` | `'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` |
| `--font-label` | `var(--font)` | `var(--font-num)` |
| `--font-mono` | `ui-monospace, 'SF Mono', Menlo, Consolas, monospace` (the footer's `code`) | `var(--font-num)` |
| `--label-case` | `none` | `uppercase` |
| `--label-tracking` | `0` | `0.04em` |

Every number (returns, weights, euros, dates, the badge's text in Desk, chart labels) is set in `--font-num`; labels (window names, column heads, section asides) in `--font-label` with `text-transform: var(--label-case)` and `letter-spacing: var(--label-tracking)`.

### Scale

Role tokens, so a component names what the text is, not how big it is. Phone values apply at ≤ 40rem.

| Token | Used for | Glance | Desk |
|---|---|---|---|
| `--text-body` | body, list rows | `0.9375rem` (15) | `0.8125rem` (13) |
| `--text-title` | the page's name (`h1`) | `1.0625rem` (17), 700 | `0.9375rem` (15), 600, `--font-num` |
| `--text-section` | a section's title | `0.8125rem` (13), 600, `--muted` | `0.8125rem` (13), 600, `--fg` |
| `--text-label` | window labels, column heads, asides | `0.75rem` (12), 600 | `0.6875rem` (11), 500 |
| `--text-note` | badge, notes, footer, detail | `0.8125rem` (13) | `0.71875rem` (11.5) |
| `--text-cell` | table cells, fund name in a card | `0.84375rem` (13.5); phone `0.71875rem` (11.5) | `0.78125rem` (12.5); phone `0.71875rem` (11.5) |
| `--text-name` | a fund's short name | `0.90625rem` (14.5), 700 | `0.78125rem` (12.5), 600 |
| `--text-tile` | a window's value in a cell or tile | `1.125rem` (18), 700; phone `1.0625rem` (17) | `1.375rem` (22), 600; phone `1rem` (16) |
| `--text-hero` | the 1-day number | `4.25rem` (68), 700, `-0.035em`, proportional figures; phone `3.5rem` (56) | not used: Desk's 1d is a tile |
| `--text-figure` | allocation's equities/bonds figures; the euro "worth" amount | `1.25rem` (20), 700 | `0.75rem` (12), 600 |
| `--text-small` | a start date, a euro amount under a return, a cell's label on a phone | `0.71875rem` (11.5); phone label `0.65625rem` (10.5) | `0.6875rem` (11); phone `0.625rem` (10) |
| `--leading` | line height | `1.5` | `1.45` |
| `--weight-strong` / `--weight-bold` | | `600` / `700` | `600` / `600` |

## Spacing and layout

### Spacing

A 4 px base, shared by both views: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 24, `--space-6` 32, `--space-7` 48 (px). Per view:

| Token | Glance | Desk |
|---|---|---|
| `--card-pad` | `20px 22px`; phone `16px`; positions card on a phone `16px 12px` | `8px 9px`; phone `6px` |
| `--grid-gap` | between cards: `16px`; phone `12px` | `10px`; phone `8px` |
| `--cell-gap` | between tinted cells or tiles | `6px` (table `4px`, phone `3px`) | `1px` (the line shows through) |

Shared: `--gutter` (page side padding) `16px` on a phone, `24px` from 40rem, `28px` from 64rem; `--page-max` `74rem` (1184 px).

### Breakpoints

The product's own, in `rem` so text zoom moves them:

| Width | Stands for | What changes |
|---|---|---|
| ≤ 40rem (640 px) | phone (360 px is the design size) | positions become one card per fund; the performance cells go 2 per row (Glance) or 3 (Desk); smaller card padding |
| 40.0625–64rem | tablet (768 px) | the positions table appears, with tighter columns; sections stack one per row |
| ≥ 64rem (1024 px) | laptop (1280 px) | the page grid below |

There is also a 56rem step inside the tablet range for Desk's positions only ("Positions").

### Page grid

One column below 64rem, sections in the SPEC's order: header, performance, chart, positions, allocation, footer. From 64rem, `main` is a 12-column grid with `--grid-gap`, the same in both views:

| Row | Sections |
|---|---|
| 1 | performance (12 columns) |
| 2 | chart (8) · allocation (4) |
| 3 | positions (12) |

Placement: `#performance, #positions { grid-column: 1 / -1 }`, `#chart { grid-column: 1 / span 8 }`, `#allocation { grid-column: 9 / span 4; grid-row: 2 }` (explicit columns: with `grid-row` alone, allocation lands in the first column). Allocation stays after positions in the markup, so a phone and a screen reader meet positions first; it has nothing focusable, so the tab order still follows the screen. Cards in a row stretch to the same height.

## Views

Two looks of the same page and data. **Glance** is the default. **Desk** is the market-desk sibling. The difference is bounded: two token sets (Tokens, Type, Shape, Spacing above give both values) and two layout differences, the performance section and the positions. Everything not in the table below is shared, and each section's `###` says in a line or two how it looks in Desk where it differs.

### The view control

A two-segment control at the right of the header's first row: **Glance | Desk**.

- **Markup**: `<div class="view-switch" role="group" aria-label="View">` with two `<button type="button" aria-pressed="true|false">`; the words are the labels, no icons. Not ARIA tabs: there are no tab panels, the whole page changes.
- **Where**: in both views, the header's first row, right-aligned, on the same line as the page name (at 360 px: name ≈ 150 px, control ≈ 150 px, both fit with room). It never moves between views, so the finger finds it in the same place to switch back. Below 300 px it wraps under the name, left-aligned.
- **Size**: each segment is at least 44 px tall and wide (`min-height: var(--hit)`, padding `0 16px`); the group has a 1px `--line` border, `--surface` background, radius `--radius-control`, no gap between segments.
- **States**: chosen: `--accent` background, `--on-accent` text, `--weight-bold` (Glance: an ink pill; Desk: a blue block). Not chosen: `--muted` text on `--surface`; hover `--surface-2` background, `--fg` text; pressed (`:active`) as hover. Focus: the `--focus` ring, `--focus-ring` wide and offset, around the one segment. The chosen segment ignores a click (it is already the view).
- **Type**: Glance `--text-note` 13 px, 600; Desk `--font-label`, uppercase, 11 px, 500, tracking 0.04em.
- **Switching**: sets `data-view="desk"` on `<html>` (removes it for Glance), writes `localStorage['portfolio-tracker.view']` = `glance` or `desk` (inside `try`; a browser that refuses storage just forgets), and moves nothing else: focus stays on the button, the scroll position stays. Instant, no transition.
- **First paint**: a five-line inline script at the top of `<head>` reads the key and sets `data-view` before the stylesheet paints, so a Desk user never sees Glance flash. A missing or unknown value means Glance.

### What differs in Desk

| | Glance | Desk |
|---|---|---|
| Colour | blue/orange returns with tinted cells; warm off-white or near-black page, white or graphite cards | green/red returns, no tints; blue-grey page with white panels, or the dark terminal panels |
| Type | Manrope throughout | Plex Sans for text, Plex Mono for every number, label and the badge; labels uppercase |
| Shape | rounded cards (18 px) with a soft edge, rounded cells | 6 px panels with a 1px edge; each section's title is a head bar on `--surface-2` with a rule under it |
| Badge | a filled pill on `--surface`: a dot, the text in `--muted`, the state words bold in the state's colour | a bordered pill, no fill and no dot: the whole text in the state's colour, the border the same colour at 50 % |
| Chart's end | the latest value as bold text beside the end dot | the latest value in a filled `--accent` price tag at the right edge |
| Sparklines | neutral `--muted`, end dot `--fg` | coloured by the fund's 2m sign |
| **Performance** (layout 1) | the 1-day return as one big number; 5d · 1w · 1m · 2m as four tinted cells under it (beside it from 64rem) | five equal tiles in one row (three per row on a phone), the 1d tile like the others |
| **Positions** (layout 2) | name over asset class in one column; returns as tinted rounded cells | asset class in its own column from 56rem; returns as plain coloured text in a dense ruled table |

Everything else is shared: the page grid, the order of sections, the header's rows and the control's place, the chart's geometry and readout, the allocation's structure, the footer, the phone cards' structure, every text and every state. T-007 builds one page: one DOM; the differences are tokens plus two CSS blocks scoped to `:root[data-view='desk']`, one for `.tiles` and one for `.positions`. Where a difference cannot be a token value (a `display`, a font on one element), a one-line rule under `:root[data-view='desk']` is allowed, and these are all of them: the badge (no fill, no shadow, no dot, the text in the tone, the border at 50 %); the page name, the view control's and the primary button's labels in `--font-label` uppercase; the allocation's split on one line and its class rows with hairlines; the link-style button without underline; the chart tag's text at 11 px 600; the euro lines at 10 px in phone cells. The D-002 reference page has exactly these. A new one is a change to this file first.

## Sections

### Header and badge

**Rows.** Below 64rem: row 1 the page name (left) and the view control (right); row 2 the badge; row 3 the note "Funds price once a day; the NAV of a day is published the next working day." From 64rem: row 1 the name, the badge beside it, the control at the right (`margin-left: auto`); row 2 the note. Grid areas, `gap: 8px 16px`. The header sits on the page background, not in a card; `--space-5` under it, and a `--chrome-rule` line under it (visible in Desk only).

**Name**: "Portfolio tracker", `--text-title`.

**Badge** (`button.badge`, `min-height: var(--hit)`, `max-width: 100%`): `--text-note`, `--font-num` in Desk. Text `NAV as of 2026-11-03 · snapshot 2026-11-04 08:10 UTC · FRESH` in pieces that never break inside a date (as built). Glance: `--surface` fill, `--card-edge`, radius `--radius-badge`, padding `8px 16px 8px 12px`, the `--swatch` dot in the state's colour, the text `--muted`, the state words `--weight-bold` in the state's colour with `0.04em` tracking. Desk: no fill, a 1px border in the state's colour at 50 % (`color-mix(in srgb, var(--tone) 50%, transparent)`), no dot, the whole text in the state's colour, radius 12 px. On a phone the badge wraps to two lines; the pill keeps its shape (radius 22 px reads as a rounded box at two lines, which is right).

| State | Tone | Reads |
|---|---|---|
| loading | none: dot and border `--line`, text `--muted` | `Allocation as of 2026-11-04 · loading prices…` |
| no snapshot (M0) | none | `Allocation as of 2026-11-04 · no prices yet` |
| fresh | `--ok` | `… · FRESH` |
| stale | `--warn` | `NAV as of 2026-10-28 · snapshot 2026-10-29 08:10 UTC · STALE` |
| partial | `--warn` | `… · FRESH · PARTIAL` (or `STALE · PARTIAL`) |
| run not ok | `--warn` | `… · FRESH · run partial` |
| error | `--error` | `Allocation as of 2026-11-04 · prices unreadable · ERROR` |

**Detail** (opens under the badge on tap, click or Enter; Escape or a press outside closes it): a box `max-width: 40rem`, `--text-note`, lines 4 px apart, radius `--radius`, padding `12px 16px`. Background follows the tone: `--surface` with `--card-edge` for fresh and none, `--warn-bg` for warn, `--error-bg` for error, text `--fg`. Desk: the same with a 1px `--line` border instead of the edge.

**Desk**: the same rows; the name in Plex Mono 600; the bordered badge; the rule under the header.

### Performance tiles

One card (`section#performance`), title "Performance". One list (`ol.tiles`) of five tiles, one per window, each: the label, the value, the euro change (M2, see "Euro total"), the start date. Labels are the long names in both views: "1 day", "5 days", "1 week", "1 month", "2 months" (Desk uppercases them). The note under the list stays: "Portfolio return up to the NAV of 2026-11-03, from the NAV of the date under each."

**Glance.** The first tile (1d) is the hero; the other four are cells.
- Hero: no background; label `--text-label` `--muted`; the value at `--text-hero` in its sign colour, line-height 1.05, `margin: 8px 0 4px`; the date as "since 2026-11-02" in `--text-note` `--muted`. Every tile's date carries the word "since" in a span that is visually hidden (as built); only the Glance hero shows it. In Desk's phone tiles "since 2026-11-02" would not fit a third of the width.
- Cells: background the tint for their window (or `--surface-2` at `0.00 %`), radius `--radius-cell`, padding `8px 10px`; label `--text-label` in `--muted-on-tint`; value `--text-tile` in its sign colour, `-0.01em`; date `--text-small` `--muted-on-tint`.
- Layout: phone, a 2-column grid, the hero across both, cells 2 × 2 with `--cell-gap`. 40–64rem: 4 columns, the hero across all four. From 64rem (the card is full width): `grid-template-columns: minmax(0, 1.4fr) repeat(4, minmax(0, 1fr))`, the hero in the first column and the four cells beside it, aligned to the hero's bottom.

**Desk.** Five equal tiles: `grid-template-columns: repeat(5, minmax(0, 1fr))` with a 1px `--line` gap (the container's background shows through) inside a 1px `--line` border, radius 4 px; three per row on a phone (1d 5d 1w, then 1m 2m; the empty slot is `--surface`). Each tile `--surface`, padding `8px 10px 9px` (phone `6px 8px`); label `--font-label` 11 px uppercase `--muted`; value Plex Mono `--text-tile` 600 in its sign colour; date Plex Mono `--text-small` `--muted`.

| State | Shows |
|---|---|
| fresh, stale, partial | the five numbers; stale and partial look the same as fresh here (the badge carries the state) |
| a window without enough history | in place of the value, "not enough history" in `--muted` at `--text-cell`; the date line "prices from 2026-09-15"; no tint; in the hero the same, not at hero size |
| loading | the placeholder "Loading prices…", `min-height` 12rem on a phone and 8rem from 64rem, so the page does not jump when the numbers arrive |
| no snapshot | the placeholder with the command in `code` |
| error | the error placeholder: lead "No returns" then "The price snapshot could not be read, so there are no returns to show." |

### Chart

One card, title "Portfolio value", aside "2 months · indexed to 100". Over the chart the readout line ("Hover or tap the line to read any date.", then `99.77 on 2026-10-30` in `--fg` while reading); under it the note that says what 100 is (as built). Shared by both views except the colours, the line weight and the end label.

- **Geometry**: drawn at the frame's pixel width (as built); 200 px tall on a phone, 250 px from 40rem, 300 px from 64rem (so it fills its row beside the allocation). On a Glance phone the frame reaches 8 px into the card's side padding (`--chart-bleed`): at 360 px the card's inner 296 px is too narrow for the axis to label the month between the first and last dates, and 312 px is enough. Desk's thinner card padding already leaves 316 px. Y labels at the left in `--text-small` `--muted` `--font-num`; month ticks and the first and last dates under the axis. Gridlines `--line` 1 px; the 100 line dashed `--muted` (`--dash`).
- **Marks**: the line `--accent` at `--line-weight`, round joins; the area between the line and the 100 line filled `--area` (a polygon closed along the 100 line); the end dot r 3.5, `--accent`, with a 2 px `--surface` stroke.
- **End label**: a `rect.chart-end-tag` behind the latest value's text, always drawn: `fill: var(--tag-bg)`, text `fill: var(--tag-ink)`, `--weight-bold`, `--text-label` size + 1 px. Glance: transparent tag, so the value reads as bold text 8 px right of the dot. Desk: a filled `--accent` price tag, 2 px radius, in the right margin at the line's height, Plex Mono. The plot's right margin fits the tag (about 52 px).
- **Reading**: the crosshair `--muted` 1 px; the dot r 4.5, `--surface` fill, 2 px `--accent` stroke. The whole plot is the hit area (as built).
- **States**: fewer than two dates: the placeholder "Not enough history to draw a line yet…"; loading, no snapshot, error: the placeholders, `min-height` the chart's height plus the readout line, error lead "No chart".

**Desk**: blue line at 1.75 px, blue area, the filled price tag.

### Positions

One card, title "Positions", aside "8 funds · by weight". A table (`table.positions`, explicit roles, as built) of one row per fund heaviest first, then the total row "Total". Columns: asset class, fund, weight, 1d, 5d, 1w, 1m, 2m, last 2m (sparkline). The note under it stays ("Tap a fund for its full name. …").

**Shared parts.**
- Fund name: the button that opens the full name (as built), `--text-name`, `--fg`, dotted `--muted` underline 4 px under the baseline, 44 px tall hit area; the full name under it in `--text-small` `--muted` ("Vanguard US 500 Stock Index Euro - Institutional Plus (Acciones Estados Unidos)"). Escape or a press outside the cell closes the full name, as the badge's detail does. From 40rem the button's own box is its text and the 44 px target is a `::after` centred on it (no negative margins), so a name that wraps to two lines at 768 px pushes the class line down instead of running into it; on a phone the button itself is 44 px tall.
- Lagging fund (the badge's PARTIAL, when the funds' latest NAVs differ): each fund whose latest NAV is older than the newest gets a chip reading "NAV to 2026-11-02": `--warn` text, `--warn-bg`, a 1 px border in `--warn` at 50 %, radius `--radius-control`, `--text-small` 600, padding `0 6px`. It sits on the name's line: right-aligned in the fund cell from 40rem, so it stands beside the weight; on a phone straight after the name, wrapping under it (8 px above the class line) when the two do not fit the cell's three fifths, which is the case for "Japan Stock" at 360 px. No other fund gets one.
- Weight: `--weight-bold`, `--text-cell`, right-aligned.
- Sparkline: 80 × 24 px (60 × 22 on a phone), the line in `--spark-up` / `--spark-down` / `--spark-flat` by the fund's 2m sign at `--spark-weight`, an end dot r 2 in `--spark-end`, a dashed `--line` baseline at the fund's 100.
- Total row: a 2 px `--fg` rule above it; "Total" and its figures `--weight-bold`; no sparkline. Its markup is an empty `td.class` then `th` "Total" (no `colspan="2"`), so hiding the asset-class column (Glance, Desk below 56rem, the phone) keeps the total's figures under their columns.

**Glance, from 40rem.** The asset class shows under the fund's name in the fund cell (`--text-small` `--muted`), and its own column is hidden. Return cells are tinted chips: `margin: 2px`, padding `8px`, radius 8 px, `--text-cell` 600, right-aligned, sign colour, the tint for their window. Rows separated by `--line` hairlines, no zebra. Column widths from 64rem: weight 76 px, each return 76 px, trend 88 px, the fund the rest; 40–64rem: 68, 70, 64 px.

**Desk, from 40rem.** A dense ruled table: cells padding `6px 7px`, every figure Plex Mono `--text-cell`, returns plain text in their sign colour (no chips, `--tint-strength` 0), column heads `--font-label` 11 px uppercase `--muted` with a `--line` rule under them, a hovered row `--surface-2`. From 56rem the asset class has its own column (`--muted`, Plex Sans); 40–56rem it moves under the fund's name as in Glance, so the table fits 768 px.

**Phone (≤ 40rem), both views**: one block per fund, rows split by hairlines (the structure as built): line 1 the fund name (left, may wrap to two lines: "Euro Investment Grade Bond", "Eurozone Inflation-Linked Bond"; a wrapped name pushes the class down, never overlaps it, so no negative margins on the name button here) and the weight (right, `--text-body`); line 2 the asset class (`--text-small` `--muted`) and the sparkline (right); line 3 five equal cells, each with its window label above the value (`--text-small` phone size, `--muted-on-tint`) and the value at `--text-cell` phone size (11.5 px, so `−10.00 %` fits a fifth of 304 px). Glance: the cells are tinted chips, padding `5px 3px`, `--cell-gap` 3 px, radius 8 px; the positions card's padding is `16px 12px` to give them room. Desk: plain cells, padding `1px 2px`.

| State | Shows |
|---|---|
| fresh, stale, partial | every number; nothing dims |
| a window without enough history | "not enough history" in `--muted` `--text-small` in that column's cells, no tint |
| loading, no snapshot, error | names, classes and weights as usual (they come from the export); each return cell "—" in `--muted`, no tint; no sparklines; the note says why (as built) |

### Allocation

One card, title "Allocation", aside "export 2026-11-04". The same structure in both views:

1. **The split**, two figures on one line: "Equities" over `90.34 %` at the left, "Bonds" over `9.66 %` at the right; the word `--text-label` `--muted`, the figure `--text-figure` `--font-num`.
2. **The bar**: two segments, equities `--equity` and bonds `--bond`, `--bar-thick` tall, a 2 px `--surface` gap between them, the bar's ends rounded (`--radius-cell`; Desk 3 px), each segment's `title` the name and weight. No text inside.
3. **By asset class**: the eight classes heaviest first; per row a `--swatch` in its kind's colour, the English name (`title`: the Spanish one), the weight right-aligned; under the name a `--track` track on `--surface-2` with the class's share filled in its kind's colour (as built). Rows 8 px apart, `--text-body`.

Allocation comes from the export, so it has no price states: it shows the same in loading, error and every badge state.

**Desk**: blue and violet instead of slate and teal; figures 12 px Plex Mono beside their words on one line ("Equities 90.34 %"); rows 4 px apart with a `--line` hairline between them.

### Footer

On the page background, not in a card. `--text-note` `--muted`, paragraphs 6 px apart and each `max-width: 52rem` (the rule above them runs the page's width), `--space-6` above it (`--space-7` from 64rem), a `--chrome-rule` line over it (Desk only). The text as built: the allocation's export and date with `npm run import -- …` in `code` (`--font-mono`, `--fg`), the prices line from the freshness model ("Prices: fund NAVs from Vanguard (official) + Yahoo Finance (unofficial), snapshot of 2026-11-04 08:10 UTC, …"), then "Fund names are those of Vanguard and the advisor. Not investment advice; this page only reports." Its states are the prices line's (loading, no snapshot, unreadable, loaded), already written.

**Desk**: 11.5 px, the rule over it.

### Euro total (M2)

Built by T-013 after T-007; none of it exists on `main` yet. The amounts follow SPEC "Exact definitions", "Euro amounts": whole euros, `+1 234 €` / `−48 €` / `0 €` for changes, `25 312 €` for values. The chart, the sparklines and the allocation stay in percentages.

**The line** sits at the bottom of the performance card, under the note, after a `--line` hairline and `--space-3` of air. It has three states.

1. **Nothing stored**: a link-style button "Show amounts in euros": `--link`, `--text-note`, 600, underlined in Glance (1 px, offset 3 px, `--muted` underline colour), not underlined in Desk; `min-height: var(--hit)`, `inline-flex`, centred vertically.
2. **The form** (replaces the link when it is pressed; focus moves to the input):
   - Label over the input, `--text-note` 600 `--fg`: "Your portfolio's total value today, in whole euros".
   - The input group: `--surface-2` background, 1 px `--line` border, radius `--radius`, 44 px tall, `width: 11rem`; the input (`inputmode="numeric"`, `autocomplete="off"`, no placeholder) at `--text-body` `--font-num`, right-aligned; a `€` suffix in `--muted` inside the group. Focus: the group takes the `--focus` ring.
   - Then, at every width, one stack: the error (when there is one), then a row of two buttons: "Show amounts" (primary: `--accent` fill, `--on-accent` text, radius `--radius-control`, 44 px tall, padding `0 18px`, `--weight-bold`) and "Cancel" (link style, 44 px).
   - Under them, `--text-small` `--muted`: "Stays in this browser. It is never sent anywhere or saved with the project."
   - An entry that is not a whole positive number: the group's border `--error`, and directly under the group, before the buttons, in `--error` `--text-small`: "Type a whole number of euros, like 25000." (`aria-describedby`, `aria-invalid`). Nothing is stored. (Buttons beside the field would push the error away from it on a phone, which is why the form is a stack.)
3. **A total stored**: one paragraph, `--text-note`, `--muted`, with the worth in `--fg` `--weight-bold` `--font-num`: "Worth **25 312 €** on 2026-11-10, from the 25 000 € you entered for 2026-11-03; assumes nothing added or withdrawn since." Then "Change" (reopens the form, prefilled) and "Forget" (clears it at once; the line returns to state 1), both link style, 44 px, side by side after the text on a laptop and on their own row on a phone. At 360 px the sentence takes four lines; that is expected, nothing truncates.
   - **Cannot be carried** (the entered date is not in the series any more): the same line in `--warn` on `--warn-bg`, radius `--radius`, padding `8px 12px`: "The 25 000 € you entered for 2026-07-01 is older than these prices, so no amounts are shown. Type today's total to see them again." with "Change" and "Forget". No amount appears anywhere on the page.

**Amounts on the page** (only in state 3), always under the figure they belong to, in `--font-num`, tabular, never wrapping:

| Where | What | Style |
|---|---|---|
| Glance hero | the 1-day change | under the big number, `--text-figure` (20 px) 700 in its sign colour; the "since" date under it |
| Glance cell, Desk tile | the window's change | between the value and the date, `--text-small` 600 in its sign colour (Desk: 12 px Plex Mono) |
| Fund row, weight cell | the fund's value on L | under the weight, `--text-small` `--muted`, no sign |
| Fund row, return cell | the fund's change over the window | under the percentage in the same cell (and chip), `--text-small` 600 in its sign colour; the tint stays the percentage's |
| Total row | the portfolio's value under 100.00 %, each window's change under its return | as the fund rows, bold |
| A window without enough history | no amount | the cell stays "not enough history" |

On a phone a fund's block grows: the weight takes a second line (`10 085 €`) and each cell a third (`−40 €`). The widest plausible change, `−17 500 €` (a 250 000 € portfolio, 7 % on the heaviest fund), fits a fifth of the card at the phone's `--text-small`; D-002 checked five-figure changes (`−14 821 €`, a 1 500 000 € total) at 360 px in Glance. Desk's monospace needs its phone euro lines at 10 px with `-0.02em` tracking for the same. T-013 screenshots 360 px with a total of 25 000 € and one of 1 500 000 € in both views. Desk at 1280 px: the euro lines make each table row two lines tall, which is the price of the amounts; nothing else moves.

**Desk**: the link in `--accent`; the primary button a blue block, radius 4 px, label in Plex Mono uppercase 11 px; amounts in Plex Mono.

## Shared components

### Card and section head

Every section is a card: `--surface`, `box-shadow: var(--card-edge)`, radius `--radius-card`, padding `--card-pad`, `min-width: 0`. Its head is a flex row: the `h2` (`--text-section`) at the left, an optional aside (`--text-label` `--font-label` `--muted`, not bold) at the right, `margin-bottom: 12px`. Desk: the head becomes a bar: it bleeds to the card's edges (`margin: calc(-1 * pad-y) calc(-1 * pad-x) pad-y`), `--surface-2` background, padding `5px 9px`, `min-height: 30px`, a 1 px `--line` rule under it, the card's top radius. Both through the `--head-*` tokens ("Shape and size"); `--head-bleed` is 0 or 1 and multiplies the negative margins.

### Placeholder and notices

What a section shows instead of its content. A box with radius `--radius`, padding `16px`, `--text-note`.
- **Quiet** (loading, no snapshot, not enough history to draw): `--surface-2` background, `--muted` text. Desk: a dashed 1 px `--line` border, no fill.
- **Error**: `--error-bg` background, a lead in `--error` `--weight-bold` at `--text-tile` size on its own line ("No returns", "No chart"), then the sentence in `--fg`. Desk: the lead in Plex Mono uppercase 12 px ("ERROR · NO RETURNS"), a 1 px `--error` border.
- **Warning** (the euro line's "cannot be carried", the badge detail in warn): `--warn-bg`, the text `--fg`, the key word in `--warn` bold.

### Buttons, links and inputs

- Every one is at least `--hit` tall, with the `--focus` ring on `:focus-visible` only (a tap gives no ring).
- **Primary button**: `--accent` / `--on-accent`, radius `--radius-control`, padding `0 18px`, `--weight-bold`. One per view of the page at most (only the euro form has one).
- **Link-style button**: no fill, `--link` text, 600, `min-width: var(--hit)`, padding `0 8px` with `margin-left: -8px` so its text lines up with the text above; Glance underlines it.
- **Text input**: as in the euro form. Errors are in words under the field, in `--error`.

## Changes from main's tokens (for T-007)

`src/styles.css` before this direction had a neutral set. T-007 changes values and adds roles; component rules mostly keep their names.

| Was | Becomes | Note |
|---|---|---|
| `--accent` (equities and the interactive colour) | `--accent` keeps "interactive" (chart line, chosen view, primary button); equities move to `--equity` | `[data-kind='equity'] { --kind: var(--equity) }` |
| `--accent-2` (bonds) | `--bond` | retire `--accent-2` |
| `--text-xs` … `--text-xl` | the role tokens in "Type › Scale" | retire the size scale once nothing uses it |
| `--radius` (4 px for everything) | `--radius-card`, `--radius-cell`, `--radius` (12 / 4), `--radius-control` | |
| `--bar-thin` 8 px | `--bar-thick` | |
| `--page-max` 60rem | 74rem | the laptop grid needs it |
| `--spark-w` / `--spark-h` 64 × 20 | 80 × 24, phone 60 × 22 | |
| (new) | `--surface-2`, `--muted-on-tint`, `--on-accent`, `--link`, `--up-tint`, `--down-tint`, `--tint-strength`, `--warn-bg`, `--error-bg`, `--equity`, `--bond`, `--area`, `--spark-*`, `--tag-*`, `--card-edge`, `--chrome-rule`, `--head-*`, `--font-num`, `--font-label`, `--label-case`, `--label-tracking`, `--card-pad`, `--grid-gap`, `--cell-gap` | |
| `--surface`, `--bg`, `--fg`, `--muted`, `--line`, `--up`, `--down`, `--ok`, `--warn`, `--error`, `--focus`, `--space-*`, `--hit`, `--border`, `--focus-ring`, `--line-weight`, `--spark-weight`, `--track`, `--swatch`, `--dash`, `--gutter`, `--font`, `--font-mono`, `--leading`, `--weight-strong` | same names, new values | |
