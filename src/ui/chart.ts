// The portfolio's value over the last two months, indexed to 100. M0: no prices, so no line.
import type { Freshness } from '../lib/freshness.ts';
import { placeholder, section } from './dom.ts';

export function renderChart(freshness: Freshness): HTMLElement {
  void freshness; // M1 draws the line from the snapshot.
  return section(
    'chart',
    'Portfolio value, last two months',
    placeholder('Prices are not wired yet, so there is no line to draw.'),
  );
}
