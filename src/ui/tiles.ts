// Performance tiles: the portfolio return over 1d · 5d · 1w · 1m · 2m. M0: no prices, so no tiles.
import type { Freshness } from '../lib/freshness.ts';
import { placeholder, section } from './dom.ts';

export const WINDOWS = ['1d', '5d', '1w', '1m', '2m'] as const;

export function renderTiles(freshness: Freshness): HTMLElement {
  void freshness; // M1 renders the five tiles from the snapshot.
  return section(
    'performance',
    'Performance',
    placeholder(`Prices are not wired yet. The portfolio's return over ${WINDOWS.join(' · ')} will show here once they are.`),
  );
}
