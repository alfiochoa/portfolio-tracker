// Literal fixtures for src/lib/returns.ts. Dates and NAVs written out; the expected values in
// tests/returns.test.ts are computed by hand from these (as exact fractions).
import type { Portfolio } from '../../src/lib/portfolio.ts';
import type { Bar } from '../../src/lib/yahoo.ts';

export type Funds = Record<string, { bars: Bar[] }>;

/** A portfolio of the given weights, anchored on `anchorDate`. */
export const allocation = (anchorDate: string, weights: Record<string, number>): Portfolio => ({
  anchorDate,
  sourceFile: 'distribucion_agregada_cartera.xlsx',
  positions: Object.entries(weights).map(([fund, weight]) => ({ fund, weight })),
});

/** Bars from rows of `[date, navA, navB, ...]`, one fund per column. */
export function columns(ids: readonly string[], rows: readonly (readonly [string, ...number[]])[]): Funds {
  return Object.fromEntries(ids.map((id, i) => [id, { bars: rows.map((r): Bar => [r[0], r[i + 1] as number]) }]));
}

/**
 * Three funds, weights 0.5 / 0.3 / 0.2, anchored inside the series on 2026-10-30 (so V(T) = 1 and
 * V(L) is not). Sparse on purpose: series position and calendar give different starts.
 *
 *   L = 2026-11-03 (Tue)
 *   1d  S = 2026-11-02, the date before L
 *   5d  S = 2026-10-27, five series dates before L
 *   1w  L − 7 = 2026-10-27, a series date            -> S = 2026-10-27
 *   1m  2026-10-03 is a Saturday, not in the series   -> S = 2026-10-02 (Fri)
 *   2m  2026-09-03, a series date                     -> S = 2026-09-03
 */
export const three = {
  portfolio: allocation('2026-10-30', { a: 0.5, b: 0.3, c: 0.2 }),
  funds: columns(
    ['a', 'b', 'c'],
    [
      ['2026-09-02', 10, 20, 40],
      ['2026-09-03', 9.5, 21, 40],
      ['2026-10-02', 11, 19, 41],
      ['2026-10-05', 11.5, 19, 41],
      ['2026-10-27', 12, 18, 42],
      ['2026-10-28', 12, 18.5, 42],
      ['2026-10-29', 12.5, 18.5, 42.5],
      ['2026-10-30', 12.5, 19, 42],
      ['2026-11-02', 13, 19, 42],
      ['2026-11-03', 13.5, 19.5, 43],
    ],
  ),
};

/** Every weekday from `from` to `to` inclusive, NAV 100 + 1 per bar. */
export function weekdayBars(from: string, to: string): Bar[] {
  const bars: Bar[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) bars.push([d.toISOString().slice(0, 10), 100 + bars.length]);
  }
  return bars;
}
