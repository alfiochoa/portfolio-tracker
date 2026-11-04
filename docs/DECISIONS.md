# Decisions

Newest first. One entry per decision: what was chosen, over what, and why. Keep entries short.

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
