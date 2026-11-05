// The euro amounts (SPEC "Exact definitions", "Euro amounts"): the total Alfredo typed, carried to
// the latest date by the value index, split by fund, and each window's change. Pure: no DOM, no
// storage, no clock. The page and scripts/recompute.ts both call computeEuros, so they cannot disagree.
//
//   E₀, D   the euros typed and the latest date when they were typed (the stored total)
//   E       E₀ · V(L) / V(D), what the portfolio is worth on L
//   E_i     E · w_i · P_i(L) / P_i(T) / V(L), fund i's value on L; the eight sum to E
//   change  E · r / (1 + r) over a window of return r (= E − E · V(S)/V(L)); per fund E_i · r_i / (1 + r_i)
//
// Nothing is rounded here: amounts are rounded at display time (formatEuros).
import type { Portfolio } from './portfolio.ts';
import { lastOnOrBefore, type Returns, type WindowId } from './returns.ts';
import type { Bar } from './yahoo.ts';

/** What the browser keeps: the euros typed and the latest date at that moment. */
export interface StoredTotal {
  /** E₀, a positive whole number of euros. */
  euros: number;
  /** D, an ISO date: the badge's latest date when the total was typed. */
  asOf: string;
}

export type WindowEuros =
  | {
      window: WindowId;
      enough: true;
      /** The portfolio's change over the window, in euros. */
      portfolio: number;
      /** Each fund's change over the window, by fund id. */
      funds: Record<string, number>;
    }
  /** The window has no start, so no amount. */
  | { window: WindowId; enough: false };

export type Euros =
  | {
      kind: 'carried';
      entered: StoredTotal;
      /** L. */
      latest: string;
      /** E, the portfolio's value on L. */
      worth: number;
      /** E_i, each fund's value on L, by fund id. */
      funds: Record<string, number>;
      /** One per window, in the order of `Returns.windows`. */
      windows: WindowEuros[];
    }
  /**
   * D is not a date of the portfolio series: older than the history (`older`), or a date that was
   * dropped or lies after L. No amount can be carried, so none is shown.
   */
  | { kind: 'not-in-series'; entered: StoredTotal; older: boolean };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The stored value is usable: a positive whole number of euros and an ISO date. */
export function isStoredTotal(value: unknown): value is StoredTotal {
  if (typeof value !== 'object' || value === null) return false;
  const { euros, asOf } = value as Record<string, unknown>;
  return typeof euros === 'number' && Number.isSafeInteger(euros) && euros > 0 && typeof asOf === 'string' && ISO_DATE.test(asOf) && !Number.isNaN(Date.parse(asOf));
}

/** The stored text to a total, or null when it is absent or does not parse to one. */
export function parseStoredTotal(text: string | null): StoredTotal | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isStoredTotal(value) ? { euros: value.euros, asOf: value.asOf } : null;
}

/** What a person typed, as whole euros, or null when it is not a positive whole number. */
export function parseEuros(typed: string): number | null {
  const text = typed.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The amounts for `total`, from the returns, the snapshot's bars and the allocation. Each fund's
 * NAV on the anchor is found as computeReturns finds it (the last bar on or before T, by the same
 * helper). Throws only when the bars disagree with the returns (a fund without a NAV on L), which
 * computeReturns would already have refused.
 */
export function computeEuros(
  portfolio: Portfolio,
  funds: Readonly<Record<string, { bars: readonly Bar[] }>>,
  returns: Returns,
  total: StoredTotal,
): Euros {
  const d = returns.dates.indexOf(total.asOf);
  if (d < 0) return { kind: 'not-in-series', entered: total, older: returns.dates.length === 0 || total.asOf < returns.dates[0]! };

  const last = returns.values.length - 1;
  const vL = returns.values[last]!;
  const worth = (total.euros * vL) / returns.values[d]!;

  const values: Record<string, number> = {};
  for (const { fund, weight } of portfolio.positions) {
    const bars = funds[fund]?.bars ?? [];
    const t = lastOnOrBefore(
      bars.map(([date]) => date),
      returns.anchor,
    );
    const atL = bars.find(([date]) => date === returns.latest);
    if (t < 0 || !atL) throw new Error(`fund ${fund} has no NAV on the anchor or on ${returns.latest}`);
    values[fund] = (worth * weight * atL[1]) / bars[t]![1] / vL;
  }

  const change = (value: number, r: number): number => (value * r) / (1 + r);
  const windows = returns.windows.map((w): WindowEuros => {
    if (!w.enough) return { window: w.window, enough: false };
    const byFund: Record<string, number> = {};
    for (const id of Object.keys(values)) byFund[id] = change(values[id]!, w.funds[id]!);
    return { window: w.window, enough: true, portfolio: change(worth, w.portfolio), funds: byFund };
  });

  return { kind: 'carried', entered: total, latest: returns.latest, worth, funds: values, windows };
}
