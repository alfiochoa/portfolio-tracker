// Positions: one row per fund, heaviest first, then a total row.
// The table reflows into one card per fund on a phone (styles.css), so the cells carry explicit
// roles: a table whose rows are display:grid keeps its meaning for screen readers that way.
import { formatPercent, NO_VALUE } from '../lib/format.ts';
import type { Freshness } from '../lib/freshness.ts';
import { totalWeight, type Position } from '../lib/portfolio.ts';
import { h, section } from './dom.ts';
import { WINDOWS } from './tiles.ts';

function returnCells(): HTMLElement[] {
  // M0: the columns exist and say there is no value yet.
  return WINDOWS.map((w) => h('td', { role: 'cell', class: 'num ret', 'data-window': w }, NO_VALUE));
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

export function renderPositions(positions: readonly Position[], freshness: Freshness): HTMLElement {
  void freshness; // M1 fills the return cells and the sparklines.
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
      ...returnCells(),
    ),
  );
  const total = h(
    'tr',
    { role: 'row', class: 'total' },
    h('th', { role: 'rowheader', scope: 'row', colspan: '2', class: 'total-label' }, 'Total'),
    h('td', { role: 'cell', class: 'num weight' }, formatPercent(totalWeight(positions))),
    ...returnCells(),
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
    h('p', { class: 'section-note' }, 'Tap a fund for its full name. Returns appear once prices are wired.'),
  );
}
