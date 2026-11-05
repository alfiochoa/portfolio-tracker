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
- `ERROR`: the price file could not be read, or a fund has no prices in it, so there are no returns; the allocation still shows.
- `run partial` / `run failed`: the last `npm run snapshots` could not refresh some funds (they keep their previous prices), or all of them (the whole previous file is shown).

To check any number on the page, `node scripts/recompute.ts` prints what the page should show, worked out from the two data files with the same code the page uses. The exact definitions are in [docs/SPEC.md, "Exact definitions"](docs/SPEC.md#exact-definitions).

## Keeping it current

Funds publish a day's price the next morning, so the snapshot is rebuilt every working day. That happens on GitHub (A, live since 2026-11-05); a job on this computer (B) is built too and stays as the alternative.

**A. On GitHub, like market-desk (live).** The page is at **https://alfiochoa.github.io/portfolio-tracker/**, from the public repository [alfiochoa/portfolio-tracker](https://github.com/alfiochoa/portfolio-tracker) (the fund catalogue and the weights are visible there; no amounts, there are none in the repository). A scheduled job (a GitHub Actions *workflow*, `.github/workflows/refresh.yml`) runs on GitHub's computers every weekday at 08:15 UTC (09:15 in Madrid in winter, 10:15 in summer): it fetches the prices, saves the new `public/data/prices.json` in the repository when there is a new price, and publishes the page on GitHub Pages, GitHub's free hosting. It needs no key and no AI, and GitHub runs it free; your computer can be off. A run that fails sends you GitHub's usual e-mail and leaves the page as it was. To refresh by hand: **Actions → Refresh prices & deploy Pages → Run workflow**. The first run, on 2026-11-05, fetched all eight funds from both sources and committed the snapshot back as `github-actions[bot]`.

**B. On this computer.** A *cron job* (Linux's built-in scheduler) runs `scripts/refresh.sh` every weekday at 09:15 Madrid time: it fetches the prices and rebuilds the page into `dist/`, and writes one line per step, with the time and the result, to `var/refresh.log`. Nothing leaves the computer and nothing is committed to git (the changed `public/data/prices.json` stays as a local change). The computer has to be on and awake at 09:15; a missed day is caught up by the next run. What it needs from you:

1. In a terminal, run `crontab -e` (it opens your schedule in an editor).
2. Add this line at the end, save and close:
   ```
   15 9 * * 1-5 cd /home/usuario/Repos/portfolio-tracker && scripts/refresh.sh
   ```
3. To look at the page, run `npm run preview` in the repository's folder and open the address it prints (http://localhost:5200). Opening `dist/index.html` by double-click does not work: browsers do not let a page read its own data files that way.

Either way, the badge at the top shows it working: its `snapshot` time is when the prices were last fetched, and `STALE` means no new price has arrived for more than two weekdays.

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
- **The sources can miss a day.** Yahoo skipped 2026-10-26 for all eight funds; a hole inside Vanguard's last ten days is filled and stays filled, but a day missing from both stays missing.
- **Tested in Chromium only** (phone, tablet and laptop sizes); other browsers should work but are not checked.
- **Not investment advice.**

## More

How the numbers are defined: [docs/SPEC.md](docs/SPEC.md). How it is built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Decisions along the way: [docs/DECISIONS.md](docs/DECISIONS.md).
