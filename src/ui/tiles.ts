// Performance tiles: the portfolio return over 1d · 5d · 1w · 1m · 2m, each with its start date.
import { formatSignedPercent } from '../lib/format.ts';
import type { Freshness } from '../lib/freshness.ts';
import { WINDOWS, type Returns } from '../lib/returns.ts';
import { h, placeholder, section } from './dom.ts';

export { WINDOWS };

/** What a window has instead of a number when the series does not reach back to its start. */
export const NOT_ENOUGH = 'not enough history';

/** A return as the page shows it, with its sign for the colour: `0.00 %` is neither up nor down. */
export function signedReturn(fraction: number): { text: string; sign: 'up' | 'down' | 'flat' } {
  const text = formatSignedPercent(fraction);
  return { text, sign: text.startsWith('+') ? 'up' : text.startsWith('−') ? 'down' : 'flat' };
}

function tiles(returns: Returns): HTMLElement {
  const first = returns.dates[0];
  return h(
    'ol',
    { class: 'tiles' },
    ...returns.windows.map((w) => {
      if (!w.enough) {
        return h(
          'li',
          { class: 'tile', 'data-window': w.window, 'data-sign': 'none' },
          h('span', { class: 'tile-label' }, w.window),
          h('span', { class: 'tile-value tile-missing' }, NOT_ENOUGH),
          h('span', { class: 'tile-start' }, `prices from ${first}`),
        );
      }
      const { text, sign } = signedReturn(w.portfolio);
      return h(
        'li',
        { class: 'tile', 'data-window': w.window, 'data-sign': sign },
        h('span', { class: 'tile-label' }, w.window),
        h('span', { class: 'tile-value num' }, text),
        h('span', { class: 'tile-start' }, h('span', { class: 'visually-hidden' }, 'since '), h('time', { datetime: w.start }, w.start)),
      );
    }),
  );
}

export function renderTiles(freshness: Freshness, returns: Returns | null): HTMLElement {
  if (freshness.state === 'loaded' && returns) {
    return section(
      'performance',
      'Performance',
      tiles(returns),
      h('p', { class: 'section-note' }, `Portfolio return up to the NAV of ${returns.latest}, from the NAV of the date under each.`),
    );
  }
  const text =
    freshness.state === 'unreadable'
      ? "The price snapshot could not be read, so there are no returns to show."
      : freshness.state === 'loading'
        ? 'Loading prices…'
        : `Prices are not wired yet. The portfolio's return over ${WINDOWS.join(' · ')} will show here once they are.`;
  return section('performance', 'Performance', placeholder(text));
}
