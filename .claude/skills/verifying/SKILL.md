---
name: verifying
description: How a change to portfolio-tracker is checked: your own server on your port, the check command, the viewports and themes that matter, the data files the numbers are checked against, which outputs to open and what to look for. Read before reporting a change and before verifying a task.
---

# Verifying a change

Look at the result; a green run is not enough on its own.

## What matters

| Viewport | Stands for |
|---|---|
| 360×740 | Alfredo's phone, the main way he will glance at it |
| 768×1024 | a tablet, sections start sitting side by side |
| 1280×800 | his laptop |

Both themes (dark and light; the page follows `prefers-color-scheme` and a toggle once the design lands). One language, English.

The numbers are the product. Anything `docs/SPEC.md` calls exact (weights, the five window returns, the value index, the badge state) is checked against the data files, not only against the screen: `node scripts/recompute.ts` prints what the page should show from `data/portfolio.json` and `public/data/prices.json`; for at least one window, do the arithmetic yourself from the bars in `prices.json` (a few lines of Python with literal numbers) and compare all three. A page that is pretty and off by one trading day is a fail.

## The commands, each in your own checkout

- Your own server: `npm run dev -- --port $TEAM_PORT` (or `npm run preview -- --port $TEAM_PORT` for the built site). Stop it by its port (`lsof -ti tcp:$TEAM_PORT | xargs kill`), never with `pkill` or `killall`.
- **The check command**: `npm run check` (typecheck, lint, unit tests; no network). It must pass before any report.
- The quick check while you work: `npx vitest run tests/<module>.test.ts`.
- The full run, once per milestone on the closing commit, the verifier's: `npm run build && npm run e2e` (Playwright smoke against the built site, Chromium sandboxed, network to third parties mocked or blocked).
- The scripts: `npm run import -- distribucion_agregada_cartera.xlsx` (the export sits gitignored at the repo root; if your checkout lacks it, copy it from the main checkout, `$TEAM_REPO`), `npm run snapshots` (real network; the only command that may call a price source, and it keeps the previous file on failure).

## How to verify a change

1. Run the built site under Playwright at the three sizes, both themes, `chromiumSandbox: true`, pointed only at your own port.
2. Walk each acceptance line of the task, then what a user would get wrong or what the data could do: a snapshot missing, a fund with a missing date, a stale snapshot (fake the clock), a weight file that does not sum to 1, a 360 px screen with the longest fund name.
3. Save the evidence in `$TEAM_DIR/evidence/<task-id>/` and read it: overlapping text, a tile without its start date, a wrong sign colour, a badge that says FRESH on old data, a number that differs from `recompute.ts`.
4. For anything the spec calls exact, check the data directly (see above), not only the screen.

## Traps

- `.team/` sits inside the main checkout: any tool that globs the whole tree (eslint, tsc, vitest, playwright) must ignore `.team`, or it lints the designer's mock-up scripts. `eslint.config.js` does; keep it so when adding a tool.
