# Decisions

Newest first. One entry per decision: what was chosen, over what, and why. Keep entries short.

## 2026-11-04: the page tells "no snapshot" from "unreadable" by the HTTP status: 404 is the former, everything else the latter (architect, from builder-1's T-004 report)

The spec names two states for a page without numbers: no snapshot yet (quiet placeholders) and snapshot unreadable (badge `ERROR`). The page fetches `data/prices.json` relative to itself; a 404 means the file is not there (no snapshot), and any other failure (a network error, another status, JSON that does not parse, a snapshot the definitions cannot compute from, such as a fund with no bars) is unreadable and logged to the console with its reason. The fetch is sent with `cache: 'no-cache'` so a snapshot rebuilt today is revalidated rather than served from yesterday's cache; the file is 35 kB, so the revalidation costs nothing worth saving. The page and `scripts/recompute.ts` share `readPrices` (parse, then compute), so a file the oracle refuses is one the page refuses, with the same reason.

## 2026-11-04: a Yahoo bar carries the NAV date; prices are read back as the shortest 32-bit float (builder-1, T-003)

Checked on all eight funds against Vanguard's UK professional product pages (`vanguard.co.uk/professional/product/fund/<equity|bond>/<id>/<ISIN>`, the last ten NAVs): 72 of 72 fund-dates equal, under the same date, so no shift is applied. Yahoo serves the prices as 32-bit floats (597.1246 arrives as 597.1245727539062); the parser writes the shortest decimal that is the same float, which restores Vanguard's four decimals exactly. A fund's `fetchedAt` is kept when a later run fetches the same bars, so a second run changes only `generatedAt`. The request's User-Agent is the bare `Mozilla/5.0`: full browser strings got 429 from this machine every time.

## 2026-11-04: Yahoo's missing 2026-10-26 NAV is accepted for now; Vanguard's own page becomes the second source in M2 (architect)

Yahoo has a null bar on 2026-10-26 for all eight funds although Vanguard published NAVs that day (US 500 €606.4686). The date is simply absent from the portfolio series; it moves 1d/5d around that date by one day and costs the chart one point. Vanguard's product pages give the last ten official NAVs per fund: M2 adds them as a second source that fills Yahoo's holes and takes precedence for the days it covers (task T-010). Detecting "a weekday missing in every fund" was rejected: without a holiday calendar it would flag every real non-dealing day.

## 2026-11-04: the import keeps the export's own digits for each weight (builder-1, T-002)

`JSON.stringify` of the parsed double drops digits the export wrote (`9.0423422083395308E-2` became `0.09042342208339531`), so `data/portfolio.json` is rendered from the cell's text turned into plain decimal notation, digit for digit, with an assertion that it parses to the same double. "Unrounded" is then literally true and a re-import of the same export is byte-identical. `fflate` is a devDependency (only the script uses it; a test walks the page's import graph to prove it stays out). The test fixture is the export's XML parts zipped in memory, not a committed binary.

## 2026-11-04: ISIN sources, and one to avoid (builder-1, T-002)

Each fund's ISIN was verified on Vanguard's own product page and on Finect (table in the T-002 report). Rankia's list of the Indexa/Finizens funds swaps the two bond ISINs (W02 is the government bond, X19 the corporate); it is not a source for this project.

## 2026-11-04: TypeScript pinned to 6.0.x (builder-1, T-001)

typescript-eslint 8.72 supports TypeScript `<6.1`, so `typescript` is `^6.0.3` rather than the current 7.x; raise it when typescript-eslint does. `npm audit` reports one moderate advisory (minimatch, through eslint only, dev-time); fixing it would mean downgrading eslint to 9, so it is left.

## 2026-11-04: on a phone the positions table becomes one card per fund (builder-1, T-001)

Under 40rem each row is a card (name and weight, asset class, then the five windows with their labels), with explicit ARIA table roles so it still reads as a table. A horizontally scrolling table was the alternative; it would hide the returns off-screen, and the returns are the point.

## 2026-11-04: prices come from Yahoo Finance's chart endpoint; Twelve Data only if a probe shows the free plan serves fund NAVs (architect)

The eight funds are Irish UCITS mutual funds, not ETFs. Twelve Data knows the exact share classes (`0P00011HBK` etc., Frankfurt) but its pricing page lists "Mutual funds NAV" under the Pro plan ($229/month), so the free key Alfredo offers very likely returns an error for them. Yahoo Finance's keyless chart endpoint (`/v8/finance/chart/0P00011HBK.F`) returned 65 daily EUR NAVs per fund for the last three months, checked for all eight on 2026-11-04. Chosen: Yahoo as the primary source (labelled unofficial on the badge, previous file kept on failure), one 1-credit Twelve Data probe in M1 to decide whether it stays as a fallback. Alternatives considered: proxy US-listed ETFs converted to EUR on the free Twelve Data plan (approximate, no match for the bond funds), scraping Vanguard's own site (no documented endpoint found), Morningstar's timeseries API (returned nothing).

## 2026-11-04: Vite + TypeScript, vanilla DOM, own SVG charts, fflate for the export (architect)

Same stack as market-desk so one person can keep both; no framework for one page; no chart library for one line, eight sparklines and a bar; `fflate` plus a minimal SpreadsheetML reader instead of SheetJS (the export is one sheet of three columns).

## 2026-11-04: the portfolio is a buy-and-hold of the exported weights, anchored on the export date (architect)

The export gives weights only. The value index `V(t) = Σ w_i · P_i(t)/P_i(T)` backs out the start-of-window values from today's weights, which is what "how did my current portfolio do over the last month" means; fixed-weight (daily rebalanced) returns were the alternative and would overstate nothing for short windows but are not what he holds. Exact definitions in `docs/SPEC.md`.

## 2026-11-04: the export is gitignored; `data/portfolio.json` (weights only) is committed (architect)

The product cannot run without the weights, and they are the least sensitive thing about a portfolio (no amounts, no identifiers); the `.xlsx` is a personal binary export that changes on every download. If the repository is ever made public (deploying to Pages, the owner's decision), the weights are visible on the page anyway.

## 2026-11-04: copy in English (architect)

As market-desk, and the brief was in English. The asset classes keep their Spanish names in the data and in the tooltip. Reversible at copy cost only.
