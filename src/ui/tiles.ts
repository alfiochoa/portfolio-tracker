// Performance: the portfolio return over 1d · 5d · 1w · 1m · 2m, each with its start date.
// One list of five tiles in both views; Glance shows the first (1d) as the big number and the
// other four as tinted cells, Desk five equal tiles (styles.css, docs/DESIGN.md "Performance tiles").
import type { Euros } from '../lib/euros.ts';
import { formatEuros, formatSignedPercent } from '../lib/format.ts';
import type { Freshness } from '../lib/freshness.ts';
import { WINDOWS, type Returns, type WindowId } from '../lib/returns.ts';
import { code, errorPlaceholder, h, placeholder, section } from './dom.ts';

export { WINDOWS };

/** What a window has instead of a number when the series does not reach back to its start. */
export const NOT_ENOUGH = 'not enough history';

/** A window's name as a label reads it. */
export const WINDOW_LABEL: Record<WindowId, string> = { '1d': '1 day', '5d': '5 days', '1w': '1 week', '1m': '1 month', '2m': '2 months' };

/** A return as the page shows it, with its sign for the colour: `0.00 %` is neither up nor down. */
export function signedReturn(fraction: number): { text: string; sign: 'up' | 'down' | 'flat' } {
  const text = formatSignedPercent(fraction);
  return { text, sign: text.startsWith('+') ? 'up' : text.startsWith('−') ? 'down' : 'flat' };
}

/** The move, in percent, at which a window's tint is at its strongest (docs/DESIGN.md "Colour"). */
const TINT_CAP: Record<WindowId, number> = { '1d': 1, '5d': 2.5, '1w': 2.5, '1m': 5, '2m': 7 };

/** The `--heat` of a tinted cell: 0.07 for the smallest move, up to 0.25 at the window's cap. */
export function heat(window: WindowId, fraction: number): string {
  return `--heat: ${(0.07 + 0.18 * Math.min(1, (Math.abs(fraction) * 100) / TINT_CAP[window])).toFixed(3)}`;
}

/** The window's change in euros, when a total is carried; null otherwise or when the window has no start. */
export function euroChange(euros: Euros | null, i: number, fund: string | null): string | null {
  if (euros?.kind !== 'carried') return null;
  const w = euros.windows[i];
  if (!w?.enough) return null;
  const value = fund === null ? w.portfolio : w.funds[fund];
  return value === undefined ? null : formatEuros(value, 'change');
}

function tiles(returns: Returns, euros: Euros | null): HTMLElement {
  const first = returns.dates[0];
  return h(
    'ol',
    { class: 'tiles' },
    ...returns.windows.map((w, i) => {
      const cls = i === 0 ? 'tile tile-hero' : 'tile';
      const label = h('span', { class: 'tile-label' }, WINDOW_LABEL[w.window]);
      if (!w.enough) {
        return h(
          'li',
          { class: cls, 'data-window': w.window, 'data-sign': 'none' },
          label,
          h('span', { class: 'tile-value tile-missing' }, NOT_ENOUGH),
          h('span', { class: 'tile-start num' }, `prices from ${first}`),
        );
      }
      const { text, sign } = signedReturn(w.portfolio);
      const amount = euroChange(euros, i, null);
      return h(
        'li',
        { class: cls, 'data-window': w.window, 'data-sign': sign, style: heat(w.window, w.portfolio) },
        label,
        h('span', { class: 'tile-value num' }, text),
        // The euro change takes the tile's sign colour (DESIGN.md "Euro total (M2)").
        amount === null ? null : h('span', { class: 'tile-eur num' }, amount),
        // "since" is read by a screen reader everywhere and shown only under Glance's big number.
        h('span', { class: 'tile-start num' }, h('span', { class: 'since' }, 'since '), h('time', { datetime: w.start }, w.start)),
      );
    }),
  );
}

/**
 * The performance card. `euros` are the amounts for a stored total (or null), `line` the euro
 * total's line (src/ui/total.ts), shown only when the returns are.
 */
export function renderTiles(freshness: Freshness, returns: Returns | null, euros: Euros | null = null, line: HTMLElement | null = null): HTMLElement {
  const title = 'Performance';
  if (freshness.state === 'loaded' && returns) {
    return section(
      'performance',
      title,
      null,
      tiles(returns, euros),
      h('p', { class: 'section-note' }, `Portfolio return up to the NAV of ${returns.latest}, from the NAV of the date under each.`),
      line,
    );
  }
  if (freshness.state === 'unreadable') {
    return section('performance', title, null, errorPlaceholder('No returns', 'The price snapshot could not be read, so there are no returns to show.'));
  }
  if (freshness.state === 'loading') return section('performance', title, null, placeholder('Loading prices…'));
  return section(
    'performance',
    title,
    null,
    placeholder('No price snapshot yet. Build one with ', code('npm run snapshots'), `; the portfolio's return over ${WINDOWS.join(' · ')} will show here then.`),
  );
}
