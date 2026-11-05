---
name: design-pass
description: The design rules a builder applies to anything a person sees in portfolio-tracker, since no separate designer passes after the merge: docs/DESIGN.md's binding rules and the section for each component, the two views (Glance, Desk) and two themes, what good looks like at 360 px, the screenshots to take and read. Read when a task adds or changes anything visible, before you report.
---

# The design pass is yours

The builder who changes a screen finishes it, with the same eye and the same reference a designer would use: `docs/DESIGN.md` is the design system. Read its general sections once per task ("Rules that bind design", "Tokens", "Type", "Spacing and layout", "Views") and the `###` section of each part of the page you touch ("Header and badge", "Performance tiles", "Chart", "Positions", "Allocation", "Footer", "Euro total (M2)", and the shared components under them; `grep -n '^##' docs/DESIGN.md` lists them). Build with the tokens and the shared components it names; do not invent a new visual style. The reference pictures are in `$TEAM_DIR/design/D-002/` (a page you can open with `?view=desk&theme=dark&euro=stored`) and D-001's Glance and Desk mock-ups.

## What good looks like here

- Design at 360 px first, then 768 and 1280. Targets a person touches are at least 44 px as hit area (`--hit`): the view control, the badge, a fund's name, every button and link. Nothing is fixed or sticky.
- Every return shows its sign (`+1.23 %`, `−0.45 %` with U+2212, `0.00 %` bare); figures are tabular and never wrap; a no-break space before `%` and `€`.
- Up is `--up`, down is `--down`, `0.00 %` is `--muted`: blue and orange in Glance, green and red in Desk. No other colour on a number. A tint shows the size of a move and goes only behind a return (`--heat` × `--tint-strength`).
- Two views, one page: everything Desk does differently is a token value, except the performance tiles and the positions, which have one CSS block each under `:root[data-view='desk']`. If your change needs a third Desk-only rule, it belongs in DESIGN.md first: ask the designer (through the architect).
- Tokens only: no literal colour, size or font in a component. No third-party request (fonts are in `public/fonts/`).
- Quiet: one accent per view, no gradients, no shadow beyond `--card-edge`, no animation beyond a 120 ms hover.
- Every state a person can reach is designed, not derived: loading, no snapshot, fresh, stale, partial, error, not enough history, both views, both themes. A section with nothing to show says why in a sentence.
- A design change is presentation: markup structure, styles, components, copy, motion. Where the experience needs a behaviour to change, say so in your report rather than widening the task.

## Before you report

1. Run the product on your port and look at it at 360 px before and after your change.
2. Take screenshots into `$TEAM_DIR/evidence/<task-id>/`: **360, 768 and 1280 px × light and dark × Glance and Desk** (set the view with `localStorage['portfolio-tracker.view'] = 'desk'` or a click on the control; the theme with Playwright's `colorScheme`). Name them `<view>-<width>-<theme>.png`. For a state you touched (stale, error, a euro total), add that state at 360 and 1280 in the main theme of each view. Chromium with `chromiumSandbox: true`, pointed only at your own port.
3. Read them yourself: cramped spacing, a wrapped title, a fund name over its asset class, a value cut off in a phone cell (try `−10.00 %` and the longest name, "Eurozone Inflation-Linked Bond"), a control touching an edge, a colour that is not a token, a Desk screen that still shows a tint or Manrope.
4. If you introduced or changed a pattern, update its `###` section in `docs/DESIGN.md`: rewrite the section, do not add a second one.
5. Put wider findings (a neighbouring section that now looks worse, a pattern missing from `docs/DESIGN.md`) in your report.

Direction work, options for the owner to choose between, is not a design pass: it is the designer's, who comes in for it (`docs/team/README.md`).
