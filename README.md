# portfolio-tracker

A one-page site that shows how Alfredo's portfolio of eight Vanguard index funds is doing: the allocation from the robo-advisor's latest export (each fund's weight, equities against bonds), and the return of each fund and of the whole portfolio over **1 day, 5 days, 1 week, 1 month and 2 months**, with a two-month chart. It is a sibling of [market-desk](https://github.com/alfiochoa/market-desk): a static site (plain files, no server of its own), no key in the browser, and a badge at the top that says where the prices came from and how old they are.

> **Not investment advice.** It only reports. Every number is a percentage worked out from fund prices that are a day old at best; see [Honest limitations](#honest-limitations).

## What you need

[Node.js](https://nodejs.org) 24 or newer (it runs the scripts and the local server) and npm, its package manager, which comes with it.

## Run it

Each command runs from the repository's folder (the repository is this project's folder, tracked by git).

```bash
npm ci                          # installs the exact versions in package-lock.json
npm run dev -- --port 5200      # serves the page at http://localhost:5200 while you work on it
npm run check                   # typecheck, linter and unit tests; no network
npm run build && npm run e2e    # builds the site into dist/, then opens it in a test browser and checks every section
```

The test browser is [Playwright](https://playwright.dev)'s own Chromium, at phone, tablet and laptop sizes in both themes; it never calls a price source.

## The allocation

1. Export `distribucion_agregada_cartera.xlsx` from the advisor and put it at the root of the repository (next to this README).
2. Run `npm run import -- distribucion_agregada_cartera.xlsx` (add `--date YYYY-MM-DD` if the export is not from today).
3. The page's weights and the allocation's date change; the spreadsheet itself is never committed to git, only the weights in `data/portfolio.json`.

If a fund in the export is not in the catalogue (`data/funds.json`) or the weights do not add up to 100 %, the import stops, names the row, and changes nothing.

## The prices

`npm run snapshots` fetches each fund's daily prices (its **NAV**, net asset value: the fund's official price for a day, in euros) and writes them to `public/data/prices.json`, the **snapshot**, which is the only price file the page reads. It uses two sources:

- **Yahoo Finance** gives six months of history, and is used for everything older than the last ten days.
- **Vanguard's own product pages** give the last ten official NAVs. Where both have a date, Vanguard's price wins; where Yahoo skipped a date, Vanguard fills it, and a filled date stays filled.

If one source fails for a fund, the other's prices are used and the file records why. If everything fails, the previous file is kept.

The badge reads `NAV as of <date> · snapshot <time> · <state>`; tap or hover it for the details. The states:

- `FRESH`: the newest price is no more than two weekdays old, which is normal given the one-day publication delay.
- `STALE`: older than that; the snapshot has not been rebuilt, or the sources stopped publishing.
- `PARTIAL`: some funds lack a price the others have, so the newest date or a day in the last two months is skipped.
- `ERROR`: the price file could not be read, so there are no returns; the allocation still shows.
- `run partial` / `run failed`: the last `npm run snapshots` could not refresh some funds (they keep their previous prices), or any of them (the whole previous file is shown).

To check any number on the page, `node scripts/recompute.ts` prints what the page should show, worked out from the two data files with the same code the page uses. The exact definitions are in [docs/SPEC.md, "Exact definitions"](docs/SPEC.md#exact-definitions).

## Data sources and their terms

| Source | What is taken | Terms |
|---|---|---|
| Yahoo Finance's chart endpoint (`query1.finance.yahoo.com`, the funds' Frankfurt listings) | Six months of daily NAVs per fund | Unofficial and undocumented: it can change or block scripts without notice. One request per fund per run (one retry if it does not answer). Nothing is passed on beyond this page's own file. |
| Vanguard UK's public product pages (`vanguard.co.uk`) | The last ten official NAVs per fund | Public pages, used for personal use. One request per fund per run (one retry if it does not answer). |

Neither needs a key or an account. The browser never calls either: only `npm run snapshots` does.

## Honest limitations

- **Weights only, no amounts.** The export has no euros, units or cost, so every number is a percentage.
- **A buy-and-hold of the exported allocation**, valued backwards and forwards from the export's date, not the advisor's actual trades or rebalancing.
- **"Today" is usually yesterday.** A fund publishes a day's NAV the next working day, so the newest price is normally the previous working day's.
- **Freshness is a rule**, not a promise: `FRESH` means the newest NAV is at most two weekdays old; a bank holiday can make it look `STALE` for a day.
- **The sources can miss a day.** Yahoo skipped 2026-10-26 for all eight funds; Vanguard's ten days fill such holes only while they are recent.
- **Tested in Chromium only** (phone, tablet and laptop sizes); other browsers should work but are not checked.
- **Not investment advice.**

## More

How the numbers are defined: [docs/SPEC.md](docs/SPEC.md). How it is built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Decisions along the way: [docs/DECISIONS.md](docs/DECISIONS.md).
