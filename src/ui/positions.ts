// Positions: one row per fund, heaviest first, then a total row.
// The table reflows into one card per fund on a phone (styles.css), so the cells carry explicit
// roles: a table whose rows are display:grid keeps its meaning for screen readers that way.
import { formatPercent, NO_VALUE } from '../lib/format.ts';
import type { Freshness } from '../lib/freshness.ts';
import { totalWeight, type Position } from '../lib/portfolio.ts';
import { WINDOWS, type Returns } from '../lib/returns.ts';
import { h, section } from './dom.ts';
import { NOT_ENOUGH, signedReturn } from './tiles.ts';

/**
 * The five return cells of one row: `fund` names the fund, or is null for the total row (the
 * portfolio's returns). Without returns (no snapshot, or an unreadable one) each says there is no value.
 */
function returnCells(returns: Returns | null, fund: string | null): HTMLElement[] {
  return WINDOWS.map((window, i) => {
    const attrs = { role: 'cell', class: 'num ret', 'data-window': window };
    const w = returns?.windows[i];
    if (!w) return h('td', attrs, NO_VALUE);
    if (!w.enough) return h('td', { ...attrs, class: 'ret ret-missing', 'data-sign': 'none' }, NOT_ENOUGH);
    const value = fund === null ? w.portfolio : w.funds[fund];
    if (value === undefined) return h('td', attrs, NO_VALUE);
    const { text, sign } = signedReturn(value);
    return h('td', { ...attrs, 'data-sign': sign, title: `${window} since ${w.start}` }, text);
  });
}

function fundCell(p: Position): HTMLElement {
  const fullId = `fund-${p.fund.id}-full`;
  const fullName = `${p.fund.name} (${p.fund.assetClass.es})`;
  const full = h('span', { id: fullId, class: 'fund-full', hidden: '' }, fullName);
  const button = h(
    'button',
    { type: 'button', class: 'fund-name', title: fullName, 'aria-expanded': 'false', 'aria-controls': fullId },
    p.fund.shortName,
  );
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    full.hidden = !open;
  });
  return h('td', { role: 'cell', class: 'fund' }, button, full);
}

export function renderPositions(positions: readonly Position[], freshness: Freshness, returns: Returns | null): HTMLElement {
  const prices = freshness.state === 'loaded' ? returns : null; // the sparklines are T-005's
  const head = h(
    'tr',
    { role: 'row' },
    h('th', { role: 'columnheader', scope: 'col', class: 'class' }, 'Asset class'),
    h('th', { role: 'columnheader', scope: 'col', class: 'fund' }, 'Fund'),
    h('th', { role: 'columnheader', scope: 'col', class: 'num weight' }, 'Weight'),
    ...WINDOWS.map((w) => h('th', { role: 'columnheader', scope: 'col', class: 'num ret' }, w)),
  );
  const rows = positions.map((p) =>
    h(
      'tr',
      { role: 'row', class: 'position', 'data-fund': p.fund.id, 'data-kind': p.fund.kind },
      h('td', { role: 'cell', class: 'class' }, p.fund.assetClass.en),
      fundCell(p),
      h('td', { role: 'cell', class: 'num weight' }, formatPercent(p.weight)),
      ...returnCells(prices, p.fund.id),
    ),
  );
  const total = h(
    'tr',
    { role: 'row', class: 'total' },
    h('th', { role: 'rowheader', scope: 'row', colspan: '2', class: 'total-label' }, 'Total'),
    h('td', { role: 'cell', class: 'num weight' }, formatPercent(totalWeight(positions))),
    ...returnCells(prices, null),
  );
  return section(
    'positions',
    'Positions',
    h(
      'table',
      { role: 'table', class: 'positions', 'aria-labelledby': 'positions-title' },
      h('thead', { role: 'rowgroup' }, head),
      h('tbody', { role: 'rowgroup' }, ...rows),
      h('tfoot', { role: 'rowgroup' }, total),
    ),
    h(
      'p',
      { class: 'section-note' },
      prices
        ? `Tap a fund for its full name. Returns up to the NAV of ${prices.latest}; each window starts on the date under its tile.`
        : freshness.state === 'unreadable'
          ? 'Tap a fund for its full name. No returns: the price snapshot could not be read.'
          : 'Tap a fund for its full name. Returns appear once prices are wired.',
    ),
  );
}
