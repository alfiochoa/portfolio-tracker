// The footer: where the numbers come from, and how to update the allocation.
import type { Portfolio } from '../lib/portfolio.ts';
import { h } from './dom.ts';

export function renderFooter(portfolio: Portfolio): HTMLElement {
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
    h('p', {}, 'Prices: not wired yet. They will come from Yahoo Finance (unofficial), once a day.'),
    h('p', {}, 'Fund names are those of Vanguard and the advisor. Not investment advice; this page only reports.'),
  );
}
