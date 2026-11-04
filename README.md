# portfolio-tracker

Tracks how Alfredo's investment portfolio is doing: positions, allocation and performance
over time. A sibling of market-desk (the same spirit: static, honest about data freshness,
no keys in the browser); where market-desk watches the market, this watches the portfolio.

## Run it

1. `npm ci` installs the dependencies (Node 24).
2. `npm run dev` serves the page at http://localhost:5200 (add `-- --port <n>` for another port).
3. `npm run check` runs the typecheck, the linter and the unit tests (no network).
4. `npm run build && npm run e2e` builds the site and runs the browser smoke test on it.
5. The allocation lives in `data/portfolio.json`; the fund list in `data/funds.json`.

## Update the allocation

When the advisor's allocation changes, download `distribucion_agregada_cartera.xlsx` again, put it
at the root of this folder (it is never committed), and run
`npm run import -- distribucion_agregada_cartera.xlsx` (add `--date YYYY-MM-DD` if the export is
not from today). It rewrites `data/portfolio.json` with the new weights and today's date as the
allocation's date. If the export names a fund the catalogue (`data/funds.json`) does not know, or
its weights do not add up to 100 %, it stops, says which row is wrong, and leaves the file as it was;
a new fund is added to `data/funds.json` first, with its exact name as the export spells it.
