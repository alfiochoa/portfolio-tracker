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
