// Positions: one row per fund, heaviest first, then a total row.
// The table reflows into one card per fund on a phone (styles.css), so the cells carry explicit
// roles: a table whose rows are display:grid keeps its meaning for screen readers that way.
// Glance tints each return cell by the size of its move; Desk shows the same markup as a dense
// ruled table (docs/DESIGN.md "Positions").
import { chartStart, fundIndex, sparkPath } from '../lib/chart.ts';
import type { Euros } from '../lib/euros.ts';
import { formatEuros, formatPercent, NO_VALUE } from '../lib/format.ts';
import type { Freshness } from '../lib/freshness.ts';
import { totalWeight, type Position } from '../lib/portfolio.ts';
import { WINDOWS, type Returns } from '../lib/returns.ts';
import type { Bar } from '../lib/yahoo.ts';
import { s } from './chart.ts';
import { h, section } from './dom.ts';
import { euroChange, heat, NOT_ENOUGH, signedReturn } from './tiles.ts';

/**
 * The five return cells of one row: `fund` names the fund, or is null for the total row (the
 * portfolio's returns). Without returns (no snapshot, or an unreadable one) each says there is no value.
 * The value sits in a chip (the tinted cell in Glance); on a phone the chip shows its window above it.
 * With a total carried, the change in euros sits under the percentage in the same chip, so it takes its colour.
 */
function returnCells(returns: Returns | null, fund: string | null, euros: Euros | null): HTMLElement[] {
  return WINDOWS.map((window, i) => {
    const attrs = { role: 'cell', class: 'num ret', 'data-window': window };
    const chip = (text: string, more: Record<string, string> = {}) => h('span', { class: 'chip', 'data-window': window, ...more }, text);
    const w = returns?.windows[i];
    if (!w) return h('td', attrs, chip(NO_VALUE, { 'data-sign': 'none' }));
    if (!w.enough) return h('td', { ...attrs, class: 'ret ret-missing', 'data-sign': 'none' }, chip(NOT_ENOUGH, { 'data-sign': 'none' }));
    const value = fund === null ? w.portfolio : w.funds[fund];
    if (value === undefined) return h('td', attrs, chip(NO_VALUE, { 'data-sign': 'none' }));
    const { text, sign } = signedReturn(value);
    const amount = euroChange(euros, i, fund);
    const box = chip(text, { 'data-sign': sign, style: heat(window, value) });
    if (amount !== null) box.append(h('span', { class: 'chip-eur' }, amount));
    return h('td', { ...attrs, 'data-sign': sign, title: `${window} since ${w.start}` }, box);
  });
}

/** The sparkline's box, in user units; CSS sizes it to the --spark-w × --spark-h cell. */
const SPARK_W = 80;
const SPARK_H = 24;

/** The first and last points of a path of `M x y L x y …` commands. */
function ends(d: string): { first: [number, number]; last: [number, number] } {
  const pts = d
    .split(/[ML]/)
    .filter((p) => p.trim())
    .map((p) => p.trim().split(' ').map(Number) as [number, number]);
  return { first: pts[0]!, last: pts[pts.length - 1]! };
}

/**
 * The fund's own index over the chart's window (same x mapping as the chart), coloured by its
 * return over that window, with a dashed baseline at its 100 (the window's first point) and a dot
 * at its end; an empty cell when there are no prices or too few to draw.
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
  const d = sparkPath(points, start, returns.latest, SPARK_W, SPARK_H);
  const { first, last } = ends(d);
  const svg = s(
    'svg',
    { class: 'sparkline', viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label, 'data-sign': sign },
    s('line', { class: 'spark-base', x1: 0, x2: SPARK_W, y1: first[1], y2: first[1] }),
    s('path', { class: 'spark-line', d, 'data-points': points.length }),
    // A zero-length stroke with round caps: a round dot at any box size (the box is stretched on a phone).
    s('path', { class: 'spark-end', d: `M${last[0]} ${last[1]} h0` }),
  );
  const cell = h('td', attrs);
  cell.append(svg);
  return cell;
}

/** Close every open full name, except the one around `target`; with `refocus`, focus goes back to its button when it was inside. */
function closeFullNames(target: EventTarget | null, refocus: boolean): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.fund-name[aria-expanded="true"]')) {
    const cell = button.closest('td');
    if (!cell) continue;
    if (!refocus && target instanceof Node && cell.contains(target)) continue;
    button.setAttribute('aria-expanded', 'false');
    const full = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (full) full.hidden = true;
    if (refocus && cell.contains(document.activeElement)) button.focus();
  }
}

/**
 * One pair of document listeners for every fund name the page renders, as the badge's detail does
 * (src/ui/badge.ts): Escape closes an open full name, a press outside its cell closes it.
 */
let listening = false;
function listenOnce(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFullNames(e.target, true);
  });
  document.addEventListener('pointerup', (e) => closeFullNames(e.target, false));
}

function fundCell(p: Position, lagsTo: string | undefined): HTMLElement {
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
  listenOnce();
  // A fund whose latest NAV is older than the others' (the badge's PARTIAL): the date it reaches.
  const lag = lagsTo
    ? h('span', { class: 'lag-chip num', title: `${p.fund.shortName}'s latest NAV is of ${lagsTo}, older than the other funds'` }, `NAV to ${lagsTo}`)
    : null;
  return h(
    'td',
    { role: 'cell', class: 'fund' },
    h('span', { class: 'fund-line' }, button, lag),
    h('span', { class: 'fund-class' }, p.fund.assetClass.en),
    full,
  );
}

/** The funds whose latest NAV is older than the newest one, with that date. */
function lagging(fundLatest: Readonly<Record<string, string | null>> | null): Record<string, string> {
  if (!fundLatest) return {};
  const dates = Object.values(fundLatest).filter((d): d is string => d !== null);
  const newest = dates.reduce((a, b) => (b > a ? b : a), '');
  return Object.fromEntries(Object.entries(fundLatest).filter((e): e is [string, string] => e[1] !== null && e[1] < newest));
}

export function renderPositions(
  positions: readonly Position[],
  freshness: Freshness,
  returns: Returns | null,
  funds: Readonly<Record<string, { bars: readonly Bar[] }>> | null = null,
  fundLatest: Readonly<Record<string, string | null>> | null = null,
  euros: Euros | null = null,
): HTMLElement {
  const prices = freshness.state === 'loaded' ? returns : null;
  const carried = prices && euros?.kind === 'carried' ? euros : null;
  /** The weight, and under it the value in euros on L when a total is carried. */
  const weightCell = (weight: number, value: number | undefined) =>
    h(
      'td',
      { role: 'cell', class: 'num weight' },
      formatPercent(weight),
      carried && value !== undefined ? h('span', { class: 'eur-value' }, formatEuros(value, 'value')) : null,
    );
  const behind = prices ? lagging(fundLatest) : {};
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
      fundCell(p, behind[p.fund.id]),
      weightCell(p.weight, carried?.funds[p.fund.id]),
      ...returnCells(prices, p.fund.id, carried),
      sparkCell(p, prices, funds),
    ),
  );
  // An empty asset-class cell, then "Total" under the fund column (no colspan), so hiding the
  // asset-class column keeps the total's figures under their columns.
  const total = h(
    'tr',
    { role: 'row', class: 'total' },
    h('td', { role: 'cell', class: 'class' }),
    h('th', { role: 'rowheader', scope: 'row', class: 'total-label' }, 'Total'),
    weightCell(totalWeight(positions), carried?.worth),
    ...returnCells(prices, null, carried),
    h('td', { role: 'cell', class: 'spark' }),
  );
  return section(
    'positions',
    'Positions',
    `${positions.length} funds · by weight`,
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
            : 'Tap a fund for its full name. Returns appear once a snapshot is built.',
    ),
  );
}
