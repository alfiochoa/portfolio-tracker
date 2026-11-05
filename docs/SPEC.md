# portfolio-tracker: the spec

What we are building, for whom, and in what order. The architect keeps this true; when Alfredo changes his mind or the team learns something, this file changes first. `docs/ARCHITECTURE.md` says how it is built.

## What it is, and for whom

A one-page site that shows Alfredo how his investment portfolio is doing: today's allocation, and the return of each fund and of the whole portfolio over **1 day, 5 days, 1 week, 1 month and 2 months**. It is for Alfredo alone, on his laptop and his phone, opened for thirty seconds a day. It is a sibling of [market-desk](https://github.com/alfiochoa/market-desk): static, no backend, no key in the browser, and honest on every number about where it came from and how old it is.

The portfolio is eight Vanguard index funds (the "Institutional Plus EUR Accumulation" share classes, Irish UCITS funds priced once a day in euros), held through a robo-advisor. Alfredo exports the allocation from the advisor as `distribucion_agregada_cartera.xlsx`; that file is the source of truth for *what* he holds, and the fund prices (NAVs) come from a market-data source.

Not investment advice; it only reports.

## Concepts

- **Fund**: one of the funds in the catalogue (`data/funds.json`). It has the name the advisor's export uses, a short name, an ISIN, a kind (`equity` or `bond`), an asset class (in Spanish as exported, and in English for the screen), and the symbols each price source knows it by.
- **Portfolio**: the allocation, `data/portfolio.json`: an **anchor date** (the day the export was made) and a **weight** per fund (fraction of the invested total, the eight sum to 1). The export carries weights only: no amounts, no units, no cost. Everything the site shows is therefore relative (percentages), unless Alfredo later chooses to type a total value in his browser (M2).
- **NAV**: a fund's price for one date, in euros. Funds publish the NAV of day D on the morning of the next working day, so the newest NAV is normally yesterday's.
- **Snapshot**: `public/data/prices.json`, the NAV history of every fund as fetched by the snapshot script, with the time it was built, the source and its state. The site reads only this file; the browser never calls a market-data API.
- **Window**: one of the five periods, each defined exactly below.
- **Freshness**: every number on the page descends from one snapshot, so the page carries one badge: source, latest NAV date, snapshot time, state.

### The funds (from the export of 2026-11-04)

| Asset class (export) | Asset class (screen) | Fund (as exported) | Kind | Weight | ISIN | Yahoo symbol |
|---|---|---|---|---|---|---|
| Acciones Estados Unidos | US equities | Vanguard US 500 Stock Index Euro - Institutional Plus | equity | 39.84 % | IE00BFPM9V94 | 0P00011HBK.F |
| Acciones Europa | European equities | Vanguard European Stock Index Euro - Institutional Plus | equity | 24.80 % | (T-002 verifies) | 0P00011HBL.F |
| Acciones economías emergentes | Emerging-market equities | Vanguard Emerging Markets Stock Index Euro - Institutional Plus | equity | 9.30 % | (T-002 verifies) | 0P00011HBQ.F |
| Acciones globales pequeña capitalización | Global small caps | Vanguard Global Small Cap Index Euro - Institutional Plus | equity | 9.04 % | (T-002 verifies) | 0P00011OE2.F |
| Acciones Japón | Japanese equities | Vanguard Japan Stock Index Euro - Institutional Plus | equity | 7.36 % | (T-002 verifies) | 0P00011HBN.F |
| Bonos gobiernos europeos | Euro government bonds | Vanguard Euro Government Bond Index - Institutional Plus | bond | 4.17 % | IE00BFPM9W02 | 0P00011HBR.F |
| Bonos empresas europeas | Euro corporate bonds | Vanguard Euro Investment Grade Bond Index Euro - Institutional Plus | bond | 2.95 % | (T-002 verifies) | 0P00011IIE.F |
| Bonos europeos ligados a la inflación | Euro inflation-linked bonds | Vanguard Eurozone Inflation-Linked Bond Index Euro - Institutional Plus | bond | 2.54 % | IE00BGCZ0719 | 0P00012I68.F |

Equities 90.34 %, bonds 9.66 %. The exact weights are the export's floating-point values (`data/portfolio.json`), shown with two decimals.

## The screen

One page, sections top to bottom. It works at phone width (360 px) and on a laptop; sections stack on the phone.

1. **Header**: the name, and the **freshness badge**: `NAV as of <date> · snapshot <time> · <STATE>` with the source on hover or tap. A one-line note under it: "Funds price once a day; the NAV of a day is published the next working day."
2. **Performance**: the 1d return as one big number with its start date (yesterday's move: the question the page answers first), and the other four windows, 5d · 1w · 1m · 2m, as cells under it, each the portfolio return for the window as a signed percentage with two decimals, tinted by sign and by the size of the move, with the window's start date. In the Desk view, five equal tiles in a row.
3. **Portfolio chart**: the portfolio's value over the last two months as a line, indexed to 100 at the start of the window, with the latest value and date at the end; hovering or tapping shows the date and value.
4. **Positions**: one row per fund, sorted by weight: asset class, fund (short name; the full name on hover or tap), weight, the five window returns, and a small sparkline of the last two months. A total row with the portfolio's five returns. In the Glance view each fund is a card and each of its five returns a cell tinted by the size of that move (as in the mock-up Alfredo chose), so the eye finds which fund moved, and in which window, before reading a number; in the Desk view, one dense table. A fund whose latest NAV lags the others (the badge's PARTIAL case) is marked in its row with the date it reaches.
5. **Allocation**: a bar of equities against bonds with the percentages, and the breakdown by asset class.
6. **Footer**: source and licence notes, "not investment advice", the anchor date of the allocation and how to update it.

**Views.** A tab control in the header switches between two looks of the same page and data: **Glance** (the default; rounded cards, one big number, tinted cells, blue up and orange down) and **Desk** (the market-desk sibling: dark panels, monospaced figures, every number in one table). The choice is kept in the browser and used on the next visit. Both views have both themes and work at both widths; `docs/DESIGN.md` says what differs between them (tokens, type, the performance section and the positions) and everything else is shared.

**The euro total (M2, optional).** Under the tiles, one line. With nothing stored it is a single link, "Show amounts in euros", which opens a one-field form (whole euros) and a note that the amount stays in this browser and is never sent anywhere. With a total stored, the line says what the portfolio is worth on `L` and from what ("Worth 25 312 € on 2026-11-10, from the 25 000 € you entered for 2026-11-03; assumes nothing added or withdrawn since"), with "Change" and "Forget". Then each tile carries the window's change in euros under the percentage, each fund row its value on `L` beside its weight and the change in euros under each return, and the total row the same for the whole. The chart, the sparklines and the allocation stay in percentages.

States the page can be in: no snapshot yet (M0: positions and allocation show, performance sections say prices are not wired yet); snapshot loaded (normal); snapshot stale or partial (badge says so, numbers still shown); snapshot unreadable (badge `ERROR`, performance sections show an explicit error, positions and allocation still show).

Copy is in English (sibling of market-desk); the asset classes keep their Spanish names in the data and in the fund's full-name tooltip.

## Exact definitions

These are what the verifier checks against the data, not only against the screen.

**Series.** For each fund `i`, `P_i(t)` is its NAV on date `t`, euros, as the source gives it, dated with the NAV date (not the publication date). The **portfolio series** is defined on the dates on which every fund has a NAV; a date missing for one fund is dropped from the portfolio series and counted in the badge's `PARTIAL` state.

**Anchor.** `T` is the portfolio's anchor date and `w_i` its weights. `P_i(T)` is the last NAV on or before `T`. The portfolio's **value index** is

    V(t) = Σ_i  w_i · P_i(t) / P_i(T)

so `V(T) = 1`: it is a buy-and-hold of the exported allocation, valued backwards and forwards from the anchor. For `t` after `T` the weights drift as prices move, as a real portfolio's would.

**Latest date.** `L` is the last date of the portfolio series; the badge's "NAV as of" is `L`.

**Windows.** Each window has a start date `S`; the return is `V(L) / V(S) − 1`, and a fund's return over the same window is `P_i(L) / P_i(S) − 1`.

| Window | Start `S` |
|---|---|
| 1d | the portfolio-series date immediately before `L` |
| 5d | the portfolio-series date five dates before `L` |
| 1w | the last portfolio-series date on or before `L − 7 calendar days` |
| 1m | the last portfolio-series date on or before the same day of the previous month (the month's last day when that day does not exist) |
| 2m | likewise, two months back |

When the series does not reach far enough for a window, that tile says "not enough history" instead of a number. Note that 5d and 1w start on the same date in any week without a market holiday, so the two tiles usually agree; both are kept because Alfredo asked for both (open with him: swap 1w for a longer window). The chart and the sparklines cover the 2m window, indexed so that the first point is 100.

**Display.** Returns as percentages with two decimals and an explicit sign (`+1.23 %`, `−0.45 %`, `0.00 %`), weights with two decimals, dates as `2026-11-03`.

**Freshness states** (computed in the browser from the snapshot and the current time):

| State | When |
|---|---|
| `FRESH` | `L` is no older than two weekdays before today (the normal one-day publication lag plus one day's slack) |
| `STALE` | older than that: the snapshot was not rebuilt, or the source stopped publishing |
| `PARTIAL` | the funds disagree on their latest NAV date (some have a NAV newer than `L`, so `L` is held back by the fund that lags), or a date was dropped from the portfolio series in the 2m window |
| `ERROR` | the snapshot cannot be loaded or parsed, or a fund has no bars at all |

`PARTIAL` combines with `FRESH`/`STALE` (`FRESH · PARTIAL`). The badge also shows the snapshot's own `state` (`ok`, `partial`, `failed`) when it is not `ok`, with the reason the script recorded.

**Euro amounts (M2, optional).** The total Alfredo types, `E₀`, is taken as the portfolio's value on the latest date at that moment, `D`, and the pair is kept in the browser only (`localStorage`). On any later `L` the portfolio is worth

    E = E₀ · V(L) / V(D)

so the typed amount follows the prices as a holding with nothing added or withdrawn since `D` would (that assumption is written beside it; after adding money he types the new total). A fund's value on `L` is its share after the drift since the anchor, `E_i = E · w_i · P_i(L) / P_i(T) / V(L)`, so the eight sum to `E`. The change over a window is what the holding gained or lost between `S` and `L` given what it is worth on `L`: `E − E · V(S)/V(L)` for the portfolio (equivalently `E · r / (1 + r)` with `r` the window's return) and `E_i − E_i · P_i(S)/P_i(L)` for fund `i`; the eight fund changes sum to the portfolio's, and a change has the sign of its return. When `D` is not in the portfolio series (older than the history, or a dropped date), no amounts are shown and the control asks for the total again; a window without enough history has no amount. Amounts are rounded to whole euros at display time, half away from zero, with the sign always shown on a change (`+1 234 €`, `−48 €`, `0 €`) and never on a value (`25 312 €`), thousands grouped with a narrow no-break space. `scripts/recompute.ts --total <euros> [--total-as-of <date>]` prints them from the same functions.

## Data sources

Primary: **Yahoo Finance's chart endpoint** (`query1.finance.yahoo.com/v8/finance/chart/<symbol>.F`), which serves the Frankfurt listing of exactly these share classes, in euros, one NAV per working day, keyless, six months back. It is unofficial and may change or block; the snapshot script keeps the previous file when the fetch fails. It answers 429 to a full browser User-Agent string and 200 to a bare `Mozilla/5.0`, which the script sends: a 429 there is not rate limiting to wait out. Its dates are NAV dates (verified against Vanguard, T-003), but it can miss a day Vanguard priced (2026-10-26 for all eight funds).

Second source (M2): **Vanguard's own product pages** (`vanguard.co.uk/professional/product/fund/<equity|bond>/<id>/<ISIN>`), which list the last ten official NAVs of each share class. The snapshot overlays them on Yahoo's bars: on a date both have, Vanguard's value wins (the two have agreed on 72 of 72 fund-dates so far; a difference is printed by the script); a date Yahoo lacks inside those ten is filled. A filled date stays filled after it leaves Vanguard's window, and a NAV Vanguard published once is not lost when its page later omits it (seen around publication time): on any date from this run's first Yahoo bar on that Yahoo lacks, inside their span or after it, the previous file's value is carried forward (Yahoo still wins wherever it has a value, Vanguard over both on its dates; a date older than Yahoo's first bar falls off with the six-month window). So the newest ten days are official and complete, the older history is Yahoo's, a hole once filled never reopens, and a fund's latest date never steps back. The badge's detail and the footer name both: "Vanguard (official) + Yahoo Finance (unofficial)". When one source fails for a fund, the other's bars are used and the failure is recorded in the file (the run is `partial` when Yahoo's history could not be refreshed for a fund; a failed Vanguard fetch alone is a `warning`); when both fail for every fund, the previous file is written back with `state: failed`.

**Twelve Data** was the planned fallback (it lists the same share classes, Frankfurt) and is dropped from version 1 (2026-11-05): no key was given and none is needed, since both sources above are keyless; its pricing page puts "Mutual funds NAV" on a paid plan anyway. If a key ever appears in `.env` (gitignored, read only by the snapshot script), one 1-credit probe decides whether it serves these funds.

Verification of the source: for one fund and one date, the NAV in the snapshot must equal the NAV Vanguard publishes for that share class and date (the task that wires the source records which date and which page).

## Version 1

Version 1 is M0 + M1 + M2: the page above, running from a snapshot that is rebuilt automatically every working day, with the allocation re-importable from a new export. Out of version 1 (candidates for later): drift of the current weights against the advisor's target, rebalancing hints, a benchmark line, since-inception returns, euro amounts beyond a locally typed total, several portfolios, alerts.

## Milestones

### M0: foundation

The scaffold, the checks, and the first slice done carefully as the pattern for the rest: the allocation on the page from the export, and the direction options for Alfredo to choose the look.

Acceptance:
- From a fresh checkout, `npm ci` then `npm run dev -- --port 5200` serves the page; it shows the eight funds with their asset class and weight, sorted by weight, the weights summing to 100.00 %, and the allocation bar with equities 90.34 % and bonds 9.66 %.
- The page says plainly that prices are not wired yet (badge state `no prices yet`); nothing on it pretends to be a return.
- `npm run import -- distribucion_agregada_cartera.xlsx` regenerates `data/portfolio.json` from the export and refuses, naming the fund, an export with a fund that is not in the catalogue, or whose weights do not sum to 1 within 0.0001.
- Every fund in `data/funds.json` has its ISIN verified against two public sources and its Yahoo symbol, and T-002's report says where.
- `npm run check` (typecheck, lint, unit tests) and `npm run e2e` (Playwright smoke, sandboxed Chromium) pass; the check runs without network.
- The page works at 360 px and 1280 px wide, in dark and light, from design tokens (CSS variables) that the chosen direction can replace.
- The designer's direction options are ready for Alfredo to choose from (the choice itself, and `docs/DESIGN.md`, are M1's: a decision waiting on the owner does not hold the foundation).

### M1: performance

The snapshot script and the five windows: tiles, chart, per-fund returns, the freshness badge, the chosen design applied.

Acceptance:
- `npm run snapshots` writes `public/data/prices.json` with at least three months of daily NAVs for every fund from Yahoo Finance; run twice in a row, the second run changes nothing but `generatedAt`; when the source fails for a fund, that fund's previous bars are kept and the state and reason are recorded; when it fails for all, the previous file is written back with `state: failed`.
- One NAV per fund in the snapshot matches Vanguard's published NAV for that date (the report names the dates and pages).
- The tiles, the chart, the positions table and the total row show the values the exact definitions give, and a script in the repo recomputes them from the two data files so the verifier can compare.
- The badge states behave as the table says (verified by faking the current time and by removing a date from a fund).
- The design system from the chosen direction is applied to every section, in both views (Glance and the Desk tab), both themes, 360 px and 1280 px.
- Alfredo has chosen a visual direction from the designer's options; `docs/DESIGN.md` and the `design-pass` skill record it.
- The Twelve Data probe is done and its result recorded in `docs/DECISIONS.md` (or, if no key was given, that is recorded instead).

### M2: keeping it current

The snapshot rebuilt every working day without Alfredo, a new export imported in one command, and the optional euro total.

Acceptance (Alfredo chose GitHub Actions and Pages on 2026-11-05: the repository `alfiochoa/portfolio-tracker`, public, the page at `alfiochoa.github.io/portfolio-tracker`):
- The snapshot combines Vanguard's product pages (official, the last ten NAVs per fund) with Yahoo Finance as "Data sources" says: Vanguard wins on a shared date, Yahoo's holes inside those ten days are filled (2026-10-26 is the case to show), each fund's file entry says which dates came from Vanguard, the badge's detail and the footer name both sources, and a failure of either source for a fund leaves the other's bars in use with the failure recorded.
- The snapshot is rebuilt automatically each working day after the NAVs are published, and the page shows the new "as of" without anyone touching it.
- A new `distribucion_agregada_cartera.xlsx` dropped at the repo root and `npm run import` changes the allocation and the anchor date; the README says so in three lines.
- Optionally, Alfredo types the portfolio's total value in the page; it is kept in his browser only (never in the repository or the snapshot) and the tiles and table then also show euro amounts.
- A README in the house style: what it is, data sources and their terms, honest limitations.
