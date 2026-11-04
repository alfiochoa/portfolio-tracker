// The footer: where the numbers come from, and how to update the allocation.
import { utcTime, type Freshness } from '../lib/freshness.ts';
import type { Portfolio } from '../lib/portfolio.ts';
import { h } from './dom.ts';

/** The prices line: the source and the snapshot's date, from the one freshness model. */
function pricesLine(f: Freshness): string {
  switch (f.state) {
    case 'loading':
      return 'Prices: loading the snapshot…';
    case 'no-snapshot':
      return 'Prices: no snapshot yet. They will come from Yahoo Finance (unofficial), once a day, through npm run snapshots.';
    case 'unreadable':
      return f.generatedAt
        ? `Prices: the snapshot of ${utcTime(f.generatedAt)} from ${f.source ?? 'the price source'} could not be used, so no returns are shown.`
        : 'Prices: the snapshot could not be read, so no returns are shown.';
    case 'loaded':
      return `Prices: fund NAVs from ${f.source}, snapshot of ${utcTime(f.generatedAt!)}, rebuilt with npm run snapshots.`;
  }
}

export function renderFooter(portfolio: Portfolio, freshness: Freshness): HTMLElement {
  return h(
    'footer',
    { class: 'site-footer' },
    h(
      'p',
      {},
      `Allocation from the advisor's export (${portfolio.sourceFile}) of ${portfolio.anchorDate}. `,
      'To update it, export again, put the file at the root of the repository and run ',
      h('code', {}, `npm run import -- ${portfolio.sourceFile}`),
      '.',
    ),
    h('p', { class: 'footer-prices' }, pricesLine(freshness)),
    h('p', {}, 'Fund names are those of Vanguard and the advisor. Not investment advice; this page only reports.'),
  );
}
