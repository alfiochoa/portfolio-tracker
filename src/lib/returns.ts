// The exact definitions (SPEC "Exact definitions"), in one place (ARCHITECTURE rule 4): the
// portfolio series, the value index, and the five windows. The page and scripts/recompute.ts both
// call computeReturns, so they cannot disagree. Pure: no DOM, no I/O, no clock.
//
//   P_i(t)  fund i's NAV on date t (the snapshot's bars)
//   series  the dates on which every fund of the portfolio has a NAV; other dates are dropped
//   T       the portfolio's anchor date; P_i(T) is fund i's last NAV on or before T
//   V(t)    Σ_i w_i · P_i(t) / P_i(T), on each series date
//   L       the last series date
//   S       a window's start (see windowStart); return V(L)/V(S) − 1, per fund P_i(L)/P_i(S) − 1
import type { Portfolio } from './portfolio.ts';
import { parseSnapshot, type Snapshot } from './snapshot.ts';
import type { Bar } from './yahoo.ts';

export const WINDOWS = ['1d', '5d', '1w', '1m', '2m'] as const;
export type WindowId = (typeof WINDOWS)[number];

export type WindowReturn =
  | {
      window: WindowId;
      enough: true;
      /** S, a series date. */
      start: string;
      /** V(L)/V(S) − 1. */
      portfolio: number;
      /** P_i(L)/P_i(S) − 1, by fund id. */
      funds: Record<string, number>;
    }
  /** The series does not reach back to this window's start. */
  | { window: WindowId; enough: false };

export interface Returns {
  /** T. */
  anchor: string;
  /** L. */
  latest: string;
  /** The portfolio series' dates, ascending. */
  dates: string[];
  /** V on each of `dates`. */
  values: number[];
  /** Dates on which some fund of the portfolio has a NAV and another has none, ascending. */
  dropped: string[];
  /** One per window, in WINDOWS order. */
  windows: WindowReturn[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The calendar date `days` days before `date`. */
export function daysBack(date: string, days: number): string {
  return fromUtc(toUtc(date) - days * DAY_MS);
}

/** The same day number `months` months before `date`, or that month's last day when it has no such day. */
export function monthsBack(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = index - year * 12; // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(year, month, Math.min(d, lastDay)));
}

/** The index of the last of `dates` (ascending) on or before `date`, or -1 when there is none. */
function lastOnOrBefore(dates: readonly string[], date: string): number {
  let found = -1;
  for (let i = 0; i < dates.length && dates[i]! <= date; i++) found = i;
  return found;
}

/**
 * The index in `dates` (the portfolio series, ascending, L last) of a window's start S, or -1
 * when the series does not reach back that far.
 */
export function windowStart(dates: readonly string[], window: WindowId): number {
  const last = dates.length - 1;
  if (last < 0) return -1;
  const latest = dates[last]!;
  switch (window) {
    case '1d':
      return last - 1;
    case '5d':
      return last >= 5 ? last - 5 : -1;
    case '1w':
      return lastOnOrBefore(dates, daysBack(latest, 7));
    case '1m':
      return lastOnOrBefore(dates, monthsBack(latest, 1));
    case '2m':
      return lastOnOrBefore(dates, monthsBack(latest, 2));
  }
}

/** A fund's bars are dated, positive and strictly ascending; throws with the reason otherwise. */
function checkBars(id: string, bars: unknown): asserts bars is Bar[] {
  if (!Array.isArray(bars) || bars.length === 0) throw new Error(`fund ${id} has no bars`);
  let previous = '';
  for (const bar of bars as unknown[]) {
    const [date, nav] = Array.isArray(bar) ? (bar as unknown[]) : [];
    if (typeof date !== 'string' || !ISO_DATE.test(date)) throw new Error(`fund ${id} has a bar without a date: ${JSON.stringify(bar)}`);
    if (typeof nav !== 'number' || !Number.isFinite(nav) || nav <= 0) throw new Error(`fund ${id}'s NAV on ${date} is not a positive number`);
    if (date <= previous) throw new Error(`fund ${id}'s bars are not strictly ascending: ${date} follows ${previous}`);
    previous = date;
  }
}

/**
 * Everything the page shows as a return, from the allocation and the snapshot's funds. Throws an
 * Error saying why when it cannot: a fund of the portfolio has no bars (or malformed ones), has no
 * NAV on or before the anchor date, or the funds share no date at all.
 */
export function computeReturns(portfolio: Portfolio, funds: Readonly<Record<string, { bars: readonly Bar[] }>>): Returns {
  const ids = portfolio.positions.map((p) => p.fund);
  const navs = new Map<string, Map<string, number>>();
  const anchorNav = new Map<string, number>();
  for (const id of ids) {
    const bars = funds[id]?.bars;
    checkBars(id, bars);
    navs.set(id, new Map(bars));
    const t = lastOnOrBefore(bars.map(([d]) => d), portfolio.anchorDate);
    if (t < 0) throw new Error(`fund ${id} has no NAV on or before the anchor date ${portfolio.anchorDate}`);
    anchorNav.set(id, bars[t]![1]);
  }

  const every = new Set<string>();
  for (const id of ids) for (const date of navs.get(id)!.keys()) every.add(date);
  const dates: string[] = [];
  const dropped: string[] = [];
  for (const date of [...every].sort()) {
    (ids.every((id) => navs.get(id)!.has(date)) ? dates : dropped).push(date);
  }
  if (dates.length === 0) throw new Error('the funds have no date in common');

  const nav = (id: string, date: string): number => navs.get(id)!.get(date)!;
  const values = dates.map((date) =>
    portfolio.positions.reduce((v, { fund, weight }) => v + (weight * nav(fund, date)) / anchorNav.get(fund)!, 0),
  );

  const last = dates.length - 1;
  const latest = dates[last]!;
  const windows = WINDOWS.map((window): WindowReturn => {
    const s = windowStart(dates, window);
    if (s < 0) return { window, enough: false };
    const start = dates[s]!;
    const fundReturns: Record<string, number> = {};
    for (const id of ids) fundReturns[id] = nav(id, latest) / nav(id, start) - 1;
    return { window, enough: true, start, portfolio: values[last]! / values[s]! - 1, funds: fundReturns };
  });

  return { anchor: portfolio.anchorDate, latest, dates, values, dropped, windows };
}

/**
 * The snapshot's text to the snapshot and its returns: what the page does with the file it
 * fetched and what scripts/recompute.ts does with the file it read. Throws (with the reason) when
 * the text is not a snapshot or the returns cannot be computed from it.
 */
export function readPrices(portfolio: Portfolio, text: string): { snapshot: Snapshot; returns: Returns } {
  const snapshot = parseSnapshot(text);
  return { snapshot, returns: computeReturns(portfolio, snapshot.funds) };
}
