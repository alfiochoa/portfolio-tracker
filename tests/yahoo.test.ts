// The chart parser, against responses saved from Yahoo on 2026-11-04 (tests/fixtures/yahoo/),
// trimmed to the bars from 2026-10-20 to 2026-11-04. They cover the switch from summer time
// (bars at 06:00 UTC) to winter time (07:00 UTC) on 2026-10-25, the day Yahoo has no price for
// (2026-10-26, null in every fund) and the trailing all-null bar for the current day.
//
// The bar's date is the NAV date. Vanguard's own product pages listed, for the same share
// classes, US 500 at €597.1246 on 03 Nov 2026 and €611.9205 on 27 Oct 2026, and Euro
// Government Bond at €112.1871 on 03 Nov 2026 and €111.8750 on 27 Oct 2026: exactly the
// closes of the bars dated 2026-11-03 and 2026-10-27 here, so no shift is applied.
/* eslint-disable @typescript-eslint/no-explicit-any -- the tests reach into Yahoo's JSON to doctor it */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dateInZone, parseChart, shortestFloat32, SourceError } from '../src/lib/yahoo.ts';

const fixture = (name: string): Record<string, any> =>
  JSON.parse(readFileSync(new URL(`./fixtures/yahoo/${name}.json`, import.meta.url), 'utf8'));
const us500 = () => fixture('us500-0P00011HBK.F');
const eurogov = () => fixture('eurogov-0P00011HBR.F');
const result = (json: Record<string, any>) => json.chart.result[0];

describe('parseChart on real responses', () => {
  it('reads the US 500 bars, dated in the listing’s zone, the NAV as Vanguard publishes it', () => {
    const s = parseChart(us500());
    expect(s).toMatchObject({ symbol: '0P00011HBK.F', currency: 'EUR', timeZone: 'Europe/Berlin' });
    expect(s.bars).toEqual([
      ['2026-10-20', 605.6111],
      ['2026-10-21', 610.2842],
      ['2026-10-22', 604.3398],
      ['2026-10-23', 600.8708],
      // 2026-10-26: Yahoo's close is null (Vanguard published 606.4686); the bar is dropped.
      ['2026-10-27', 611.9205],
      ['2026-10-28', 613.8957],
      ['2026-10-29', 610.7378],
      ['2026-10-30', 599.6681],
      ['2026-11-02', 594.82],
      ['2026-11-03', 597.1246],
      // 2026-11-04: the current day's all-null bar, dropped.
    ]);
  });

  it('reads the Euro Government Bond bars the same way', () => {
    const s = parseChart(eurogov());
    expect(s.bars.at(0)).toEqual(['2026-10-20', 111.6346]);
    expect(s.bars.find(([d]) => d === '2026-10-27')).toEqual(['2026-10-27', 111.875]);
    expect(s.bars.at(-1)).toEqual(['2026-11-03', 112.1871]);
    expect(s.bars).toHaveLength(10);
  });

  it('ignores meta.regularMarketPrice and meta.regularMarketTime', () => {
    const json = us500();
    result(json).meta.regularMarketPrice = 1;
    result(json).meta.regularMarketTime = 0;
    expect(parseChart(json).bars).toEqual(parseChart(us500()).bars);
  });

  it('uses close, not adjclose', () => {
    const json = us500();
    result(json).indicators.adjclose[0].adjclose = result(json).indicators.adjclose[0].adjclose.map((x: number | null) =>
      x === null ? null : x * 2,
    );
    expect(parseChart(json).bars.at(-1)).toEqual(['2026-11-03', 597.1246]);
  });
});

describe('dates come from the listing’s time zone, not UTC', () => {
  it('reads a timestamp as the calendar day in that zone', () => {
    const t = Date.parse('2026-11-02T23:30:00Z') / 1000; // 00:30 on 3 November in Berlin
    expect(dateInZone(t, 'Europe/Berlin')).toBe('2026-11-03');
    expect(dateInZone(t, 'UTC')).toBe('2026-11-02');
    expect(dateInZone(Date.parse('2026-07-01T22:30:00Z') / 1000, 'Europe/Berlin')).toBe('2026-07-02'); // summer, UTC+2
  });

  it('dates a bar stamped late in the UTC day by the listing’s day', () => {
    const json = us500();
    const ts: number[] = result(json).timestamp;
    ts[ts.length - 2] = Date.parse('2026-11-03T23:30:00Z') / 1000; // the 2026-11-03 bar, moved to 00:30 Berlin on the 4th
    expect(parseChart(json).bars.at(-1)).toEqual(['2026-11-04', 597.1246]);
    result(json).meta.exchangeTimezoneName = 'UTC';
    expect(parseChart(json).bars.at(-1)).toEqual(['2026-11-03', 597.1246]);
  });
});

describe('parseChart refuses what it cannot trust', () => {
  const refuses = (json: unknown, reason: RegExp) => {
    expect(() => parseChart(json)).toThrow(SourceError);
    expect(() => parseChart(json)).toThrow(reason);
  };

  it('a chart error, as Yahoo sends for an unknown symbol', () => {
    refuses(fixture('not-found'), /the source reported an error: Not Found: No data found, symbol may be delisted/);
  });

  it('something that is not a chart response, or has no result', () => {
    refuses('<html>', /not a chart response/);
    refuses({ chart: { result: [], error: null } }, /no result/);
  });

  it('a currency other than EUR', () => {
    const json = us500();
    result(json).meta.currency = 'USD';
    refuses(json, /the currency is "USD", not EUR/);
    delete result(json).meta.currency;
    refuses(json, /the currency is null, not EUR/);
  });

  it('no time zone, or one this machine does not know', () => {
    const json = us500();
    result(json).meta.exchangeTimezoneName = 'Mars/Olympus';
    refuses(json, /time zone "Mars\/Olympus"/);
    delete result(json).meta.exchangeTimezoneName;
    refuses(json, /no exchangeTimezoneName/);
  });

  it('bars that are not strictly ascending', () => {
    const json = us500();
    const ts: number[] = result(json).timestamp;
    [ts[1], ts[2]] = [ts[2]!, ts[1]!];
    refuses(json, /not strictly ascending: 2026-10-21 follows 2026-10-22/);
    const dup = us500();
    const dts: number[] = result(dup).timestamp;
    dts[2] = dts[1]! + 3600; // two bars on 2026-10-21
    refuses(dup, /not strictly ascending: 2026-10-21 follows 2026-10-21/);
  });

  it('closes that are not finite positive numbers', () => {
    for (const bad of [0, -1, 'NaN', Number.POSITIVE_INFINITY]) {
      const json = us500();
      result(json).indicators.quote[0].close[3] = bad;
      refuses(json, /the close on 2026-10-23 is .*, not a positive number/);
    }
  });

  it('closes missing, or not one per timestamp', () => {
    const json = us500();
    result(json).indicators.quote[0].close.pop();
    refuses(json, /not one per timestamp/);
    delete result(json).indicators.quote;
    refuses(json, /no daily closes/);
  });
});

describe('shortestFloat32', () => {
  it('gives back the decimal Yahoo stored as a 32-bit float', () => {
    expect(Math.fround(597.1246)).not.toBe(597.1246); // stored as 597.12457275390625
    expect(shortestFloat32(Math.fround(597.1246))).toBe(597.1246);
    expect(shortestFloat32(Math.fround(594.82))).toBe(594.82);
    expect(shortestFloat32(111.875)).toBe(111.875);
    expect(shortestFloat32(Math.fround(129.607))).toBe(129.607);
  });

  it('leaves a number that is not a 32-bit float as it is', () => {
    expect(shortestFloat32(597.1246)).toBe(597.1246);
    expect(shortestFloat32(0.1)).toBe(0.1);
  });
});
