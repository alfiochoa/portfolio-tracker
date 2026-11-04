// Positions: one row per fund, heaviest first, then a total row.
// The table reflows into one card per fund on a phone (styles.css), so the cells carry explicit
// roles: a table whose rows are display:grid keeps its meaning for screen readers that way.
import { chartStart, fundIndex, sparkPath } from '../lib/chart.ts';
import { formatPercent, NO_VALUE } from '../lib/format.ts';
import type { Freshness } from '../lib/freshness.ts';
import { totalWeight, type Position } from '../lib/portfolio.ts';
import { WINDOWS, type Returns } from '../lib/returns.ts';
import type { Bar } from '../lib/yahoo.ts';
import { s } from './chart.ts';
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

/** The sparkline's box, in user units; CSS sizes it to the --spark-w × --spark-h cell. */
const SPARK_W = 64;
const SPARK_H = 20;

/**
 * The fund's own index over the chart's window (same x mapping as the chart), coloured by its
 * return over that window; an empty cell when there are no prices or too few to draw.
 */
function sparkCell(p: Position, returns: Returns | null, funds: Readonly<Record<string, { bars: readonly Bar[] }>> | null): HTMLElement {
  const attrs = { role: 'cell', class: 'spark' };
  const start = returns && chartStart(returns);
  const bars = funds?.[p.fund.id]?.bars;
  if (!returns || !start || !bars) return h('td', attrs);
  const points = fundIndex(bars, start, returns.latest);
  if (points.length < 2) return h('td', attrs);
  // The 2m cell's own number when the window has a start, so the label and the cell always agree.
  const w2m = returns.windows.find((w) => w.window === '2m');
  const twoMonths = w2m?.enough === true;
  const value = w2m?.enough ? w2m.funds[p.fund.id] : undefined;
  const { text, sign } = signedReturn(value ?? points[points.length - 1]!.value / 100 - 1);
  const label = `${p.fund.shortName}, ${twoMonths ? '2m return' : `return since ${start}`}: ${text}`;
  const svg = s(
    'svg',
    { class: 'sparkline', viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label, 'data-sign': sign },
    s('path', { d: sparkPath(points, start, returns.latest, SPARK_W, SPARK_H), 'data-points': points.length }),
  );
  const cell = h('td', attrs);
  cell.append(svg);
  return cell;
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

export function renderPositions(
  positions: readonly Position[],
  freshness: Freshness,
  returns: Returns | null,
  funds: Readonly<Record<string, { bars: readonly Bar[] }>> | null = null,
): HTMLElement {
  const prices = freshness.state === 'loaded' ? returns : null;
  const head = h(
    'tr',
    { role: 'row' },
    h('th', { role: 'columnheader', scope: 'col', class: 'class' }, 'Asset class'),
    h('th', { role: 'columnheader', scope: 'col', class: 'fund' }, 'Fund'),
    h('th', { role: 'columnheader', scope: 'col', class: 'num weight' }, 'Weight'),
    ...WINDOWS.map((w) => h('th', { role: 'columnheader', scope: 'col', class: 'num ret' }, w)),
    h('th', { role: 'columnheader', scope: 'col', class: 'spark' }, 'Last 2m'),
  );
  const rows = positions.map((p) =>
    h(
      'tr',
      { role: 'row', class: 'position', 'data-fund': p.fund.id, 'data-kind': p.fund.kind },
      h('td', { role: 'cell', class: 'class' }, p.fund.assetClass.en),
      fundCell(p),
      h('td', { role: 'cell', class: 'num weight' }, formatPercent(p.weight)),
      ...returnCells(prices, p.fund.id),
      sparkCell(p, prices, funds),
    ),
  );
  const total = h(
    'tr',
    { role: 'row', class: 'total' },
    h('th', { role: 'rowheader', scope: 'row', colspan: '2', class: 'total-label' }, 'Total'),
    h('td', { role: 'cell', class: 'num weight' }, formatPercent(totalWeight(positions))),
    ...returnCells(prices, null),
    h('td', { role: 'cell', class: 'spark' }),
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
          : freshness.state === 'loading'
            ? 'Tap a fund for its full name. Loading prices…'
            : 'Tap a fund for its full name. Returns appear once prices are wired.',
    ),
  );
}
