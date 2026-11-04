// Yahoo Finance's chart endpoint (/v8/finance/chart/<symbol>?range=6mo&interval=1d) -> daily NAV bars.
// Pure: it takes the parsed JSON and returns bars or throws a SourceError saying why not.
//
// What the response looks like for these funds (checked 2026-11-04 on all eight .F listings):
// one bar per working day stamped at 08:00 Berlin time (06:00 UTC in summer, 07:00 in winter),
// open = high = low = close, volume 0, and a trailing bar for the current day whose prices are
// all null; now and then a working day is null too (2026-10-26, in every fund, though Vanguard
// published a NAV for it). `meta.regularMarketPrice` is ignored: the bars are the data.
//
// A bar's date is the NAV date, not the day it was published: for all eight funds, the bars
// dated 2026-10-21 to 2026-11-03 equal the NAVs Vanguard's product pages list for those dates.

/** One NAV: `[date, nav]`, the date YYYY-MM-DD (the NAV date), the NAV in the fund's currency. */
export type Bar = [date: string, nav: number];

export interface ChartSeries {
  symbol: string;
  currency: string;
  /** The listing's time zone, in which each bar's timestamp is read as a calendar date. */
  timeZone: string;
  /** Ascending by date, one per date, every NAV finite and positive. */
  bars: Bar[];
}

/** The source answered, but not with something we can use. The message is the reason recorded. */
export class SourceError extends Error {
  override name = 'SourceError';
}

/** The only currency these funds are held in; anything else is the wrong share class. */
export const EXPECTED_CURRENCY = 'EUR';

/** The calendar date of an instant in a time zone, YYYY-MM-DD. */
export function dateInZone(epochSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(epochSeconds * 1000),
  );
}

/**
 * Yahoo keeps these prices as 32-bit floats, so a NAV of 591.88 arrives as 591.8800048828125.
 * This returns the shortest decimal that is the same 32-bit float (591.88), which is the number
 * the fund published; a value that is not a 32-bit float is returned unchanged.
 */
export function shortestFloat32(value: number): number {
  if (Math.fround(value) !== value) return value;
  for (let digits = 1; digits <= 9; digits++) {
    const candidate = Number(value.toPrecision(digits));
    if (Math.fround(candidate) === value) return candidate;
  }
  return value;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * The bars of one chart response. Refuses (SourceError) a response that reports an error, has no
 * result, is not in EUR, has no time zone, has prices that are not finite positive numbers, or
 * whose bars are not strictly ascending by date. Bars whose close is null (the current day's
 * placeholder) are dropped.
 */
export function parseChart(json: unknown): ChartSeries {
  if (!isRecord(json) || !isRecord(json.chart)) throw new SourceError('the response is not a chart response');
  const { chart } = json;
  if (chart.error) {
    const e = chart.error;
    const said = isRecord(e) ? [e.code, e.description].filter((s) => typeof s === 'string' && s).join(': ') : String(e);
    throw new SourceError(`the source reported an error: ${said || 'unknown'}`);
  }
  const result: unknown = Array.isArray(chart.result) ? chart.result[0] : undefined;
  if (!isRecord(result) || !isRecord(result.meta)) throw new SourceError('the response has no result');
  const { meta } = result;

  const symbol = typeof meta.symbol === 'string' ? meta.symbol : '?';
  const currency = meta.currency;
  if (currency !== EXPECTED_CURRENCY) {
    throw new SourceError(`the currency is ${JSON.stringify(currency ?? null)}, not ${EXPECTED_CURRENCY}`);
  }
  const timeZone = meta.exchangeTimezoneName;
  if (typeof timeZone !== 'string' || timeZone === '') throw new SourceError('the response has no exchangeTimezoneName');
  try {
    dateInZone(0, timeZone);
  } catch {
    throw new SourceError(`the time zone "${timeZone}" is not one this machine knows`);
  }

  const timestamps = result.timestamp ?? [];
  const indicators = isRecord(result.indicators) ? result.indicators : {};
  const quote: unknown = Array.isArray(indicators.quote) ? indicators.quote[0] : undefined;
  const closes = isRecord(quote) ? quote.close : undefined;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || closes.length !== timestamps.length) {
    throw new SourceError('the response has no daily closes, or not one per timestamp');
  }

  const bars: Bar[] = [];
  for (const [i, t] of timestamps.entries()) {
    const close: unknown = closes[i];
    if (close === null) continue; // the current day's placeholder, or a day without a price
    if (typeof t !== 'number' || !Number.isFinite(t)) throw new SourceError(`timestamp ${i} is not a number`);
    const date = dateInZone(t, timeZone);
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) {
      throw new SourceError(`the close on ${date} is ${JSON.stringify(close)}, not a positive number`);
    }
    const previous = bars.at(-1);
    if (previous && previous[0] >= date) {
      throw new SourceError(`the bars are not strictly ascending: ${date} follows ${previous[0]}`);
    }
    bars.push([date, shortestFloat32(close)]);
  }
  return { symbol, currency, timeZone, bars };
}
