// The exact definitions (SPEC "Exact definitions"), against values computed by hand from literal
// fixtures. Expected returns are written as the exact fractions the arithmetic gives.
import { describe, expect, it } from 'vitest';
import { computeReturns, daysBack, monthsBack, windowStart, WINDOWS, type WindowReturn } from '../src/lib/returns.ts';
import { allocation, columns, three, weekdayBars } from './fixtures/returns.ts';

const DIGITS = 12;

function byWindow(windows: WindowReturn[]) {
  return Object.fromEntries(windows.map((w) => [w.window, w]));
}

function enough(w: WindowReturn | undefined): Extract<WindowReturn, { enough: true }> {
  if (!w?.enough) throw new Error(`window ${w?.window} has not enough history`);
  return w;
}

describe('calendar arithmetic', () => {
  it('goes back the same day number, or to the last day of a shorter month', () => {
    expect(monthsBack('2026-11-03', 1)).toBe('2026-10-03');
    expect(monthsBack('2026-11-03', 2)).toBe('2026-09-03');
    expect(monthsBack('2026-03-31', 1)).toBe('2026-02-28');
    expect(monthsBack('2026-05-31', 1)).toBe('2026-04-30');
    expect(monthsBack('2026-05-31', 2)).toBe('2026-03-31');
    expect(monthsBack('2028-03-30', 1)).toBe('2028-02-29'); // a leap year
    expect(monthsBack('2026-01-15', 1)).toBe('2025-12-15'); // across the year
    expect(monthsBack('2026-02-28', 2)).toBe('2025-12-28');
  });

  it('goes back calendar days across a month', () => {
    expect(daysBack('2026-11-03', 7)).toBe('2026-10-27');
    expect(daysBack('2026-03-02', 7)).toBe('2026-02-23');
  });
});

describe('the three-fund fixture, by hand', () => {
  const r = computeReturns(three.portfolio, three.funds);
  const w = byWindow(r.windows);

  it('has every date in the series, L the last, nothing dropped', () => {
    expect(r.dates).toHaveLength(10);
    expect(r.latest).toBe('2026-11-03');
    expect(r.anchor).toBe('2026-10-30');
    expect(r.dropped).toEqual([]);
  });

  it('values the portfolio from the anchor: V(T) = 1', () => {
    // P(T) = 12.5, 19, 42.  V(t) = 0.5·A/12.5 + 0.3·B/19 + 0.2·C/42
    expect(r.values[r.dates.indexOf('2026-10-30')]).toBeCloseTo(1, DIGITS);
    // V(L) = 0.5·13.5/12.5 + 0.3·19.5/19 + 0.2·43/42 = 0.54 + 117/380 + 43/210 = 42001/39900
    expect(r.values.at(-1)).toBeCloseTo(42001 / 39900, DIGITS);
    // V(2026-09-03) = 0.5·9.5/12.5 + 0.3·21/19 + 0.2·40/42 = 0.38 + 63/190 + 4/21 = 8998/9975
    expect(r.values[1]).toBeCloseTo(8998 / 9975, DIGITS);
  });

  it('starts each window where the spec says', () => {
    expect(r.windows.map((x) => x.window)).toEqual([...WINDOWS]);
    expect(enough(w['1d']).start).toBe('2026-11-02');
    expect(enough(w['5d']).start).toBe('2026-10-27');
    expect(enough(w['1w']).start).toBe('2026-10-27');
    expect(enough(w['1m']).start).toBe('2026-10-02'); // 2026-10-03 is a Saturday
    expect(enough(w['2m']).start).toBe('2026-09-03');
  });

  it('gives the portfolio return V(L)/V(S) − 1 for every window', () => {
    // V(2026-11-02) = 0.52 + 0.3 + 0.2 = 51/50                       -> (42001/39900)/(51/50) − 1
    expect(enough(w['1d']).portfolio).toBeCloseTo(1303 / 40698, DIGITS);
    // V(2026-10-27) = 0.48 + 54/190 + 0.2 = 458/475                   -> (42001/39900)/(458/475) − 1
    expect(enough(w['5d']).portfolio).toBeCloseTo(3529 / 38472, DIGITS);
    expect(enough(w['1w']).portfolio).toBeCloseTo(3529 / 38472, DIGITS);
    // V(2026-10-02) = 0.44 + 57/190 + 41/210 = 491/525
    expect(enough(w['1m']).portfolio).toBeCloseTo(4685 / 37316, DIGITS);
    // V(2026-09-03) = 8998/9975
    expect(enough(w['2m']).portfolio).toBeCloseTo(6009 / 35992, DIGITS);
  });

  it('gives each fund P_i(L)/P_i(S) − 1 for every window', () => {
    const expected = {
      '1d': { a: 13.5 / 13 - 1, b: 19.5 / 19 - 1, c: 43 / 42 - 1 }, // 1/26, 1/38, 1/42
      '5d': { a: 1 / 8, b: 1 / 12, c: 1 / 42 }, // 13.5/12, 19.5/18, 43/42
      '1w': { a: 1 / 8, b: 1 / 12, c: 1 / 42 },
      '1m': { a: 5 / 22, b: 1 / 38, c: 2 / 41 }, // 13.5/11, 19.5/19, 43/41
      '2m': { a: 8 / 19, b: -1 / 14, c: 3 / 40 }, // 13.5/9.5, 19.5/21, 43/40
    };
    for (const [id, funds] of Object.entries(expected)) {
      const got = enough(w[id]).funds;
      for (const [fund, value] of Object.entries(funds)) expect(got[fund], `${id} ${fund}`).toBeCloseTo(value, DIGITS);
    }
  });
});

describe('edge cases', () => {
  it('drops a date one fund lacks, reports it, and counts series positions without it', () => {
    const funds = columns(
      ['a', 'b'],
      [
        ['2026-10-29', 100, 10],
        ['2026-10-30', 101, 10],
        ['2026-11-02', 102, 11],
        ['2026-11-03', 104, 12],
      ],
    );
    funds.b!.bars.splice(2, 1); // b has no NAV on 2026-11-02
    funds.a!.bars.push(['2026-11-04', 105]); // and a runs one day ahead of b
    const r = computeReturns(allocation('2026-11-03', { a: 0.5, b: 0.5 }), funds);
    expect(r.dates).toEqual(['2026-10-29', '2026-10-30', '2026-11-03']);
    expect(r.dropped).toEqual(['2026-11-02', '2026-11-04']);
    expect(r.latest).toBe('2026-11-03');
    const d1 = enough(byWindow(r.windows)['1d']);
    expect(d1.start).toBe('2026-10-30'); // not the dropped 2026-11-02
    // V(L) = 1 (L = T). V(2026-10-30) = 0.5·101/104 + 0.5·10/12 = 0.5·(101/104 + 5/6)
    expect(d1.portfolio).toBeCloseTo(1 / (0.5 * (101 / 104 + 5 / 6)) - 1, DIGITS);
    expect(d1.funds.b).toBeCloseTo(12 / 10 - 1, DIGITS);
  });

  it('takes P_i(T) as the last NAV on or before an anchor after the last bar', () => {
    const r = computeReturns({ ...three.portfolio, anchorDate: '2026-11-04' }, three.funds);
    expect(r.latest).toBe('2026-11-03');
    expect(r.values.at(-1)).toBe(1); // P_i(T) = P_i(L) for every fund
    // The weights now hold on 2026-11-03, so 1d differs from the fixture anchored on 2026-10-30:
    // V(2026-11-02) = 0.5·13/13.5 + 0.3·19/19.5 + 0.2·42/43, and 1d = 1/V(2026-11-02) − 1.
    const v = 0.5 * (13 / 13.5) + 0.3 * (19 / 19.5) + 0.2 * (42 / 43);
    expect(enough(byWindow(r.windows)['1d']).portfolio).toBeCloseTo(1 / v - 1, DIGITS);
  });

  it('takes P_i(T) from the fund\'s own bars when the anchor is a dropped date', () => {
    const funds = {
      a: { bars: [['2026-11-02', 100], ['2026-11-03', 110], ['2026-11-04', 120]] as [string, number][] },
      b: { bars: [['2026-11-02', 10], ['2026-11-03', 11]] as [string, number][] },
    };
    // T = 2026-11-04, dropped from the series: a's NAV that day (120), b's last on or before it (11).
    const r = computeReturns(allocation('2026-11-04', { a: 0.5, b: 0.5 }), funds);
    expect(r.dropped).toEqual(['2026-11-04']);
    // V(L) = 0.5·110/120 + 0.5·11/11
    expect(r.values.at(-1)).toBeCloseTo(0.5 * (110 / 120) + 0.5, DIGITS);
  });

  it('says "not enough history" when a start falls before the series', () => {
    const funds = columns(
      ['a'],
      [
        ['2026-10-30', 100],
        ['2026-11-02', 101],
        ['2026-11-03', 102],
      ],
    );
    const w = byWindow(computeReturns(allocation('2026-11-03', { a: 1 }), funds).windows);
    expect(enough(w['1d']).start).toBe('2026-11-02');
    expect(w['5d']).toEqual({ window: '5d', enough: false });
    expect(w['1w']).toEqual({ window: '1w', enough: false }); // 2026-10-27 is before 2026-10-30
    expect(w['1m']).toEqual({ window: '1m', enough: false });
    expect(w['2m']).toEqual({ window: '2m', enough: false });
    // One date: not even 1d.
    const one = byWindow(computeReturns(allocation('2026-11-03', { a: 1 }), columns(['a'], [['2026-11-03', 1]])).windows);
    expect(one['1d']).toEqual({ window: '1d', enough: false });
  });

  it('starts a calendar window on the series date before a weekend target', () => {
    // L = 2026-03-31 (Tue). 1m: 2026-02-28 is a Saturday -> 2026-02-27. 2m: 2026-01-31, a Saturday -> 2026-01-30.
    const dates = weekdayBars('2026-01-01', '2026-03-31').map(([d]) => d);
    expect(dates[windowStart(dates, '1m')]).toBe('2026-02-27');
    expect(dates[windowStart(dates, '2m')]).toBe('2026-01-30');
    // L = 2026-05-29 (Fri): 1m 2026-04-29 (Wed), in the series.
    const may = weekdayBars('2026-03-02', '2026-05-29').map(([d]) => d);
    expect(may[windowStart(may, '1m')]).toBe('2026-04-29');
  });

  it('starts 5d and 1w on the same date in a plain week, and apart around a holiday', () => {
    const plain = weekdayBars('2026-10-01', '2026-11-03').map(([d]) => d);
    expect(plain[windowStart(plain, '5d')]).toBe('2026-10-27');
    expect(plain[windowStart(plain, '1w')]).toBe('2026-10-27');
    const holiday = plain.filter((d) => d !== '2026-10-29');
    expect(holiday[windowStart(holiday, '5d')]).toBe('2026-10-26');
    expect(holiday[windowStart(holiday, '1w')]).toBe('2026-10-27');
  });

  it('refuses a snapshot it cannot compute from, saying why', () => {
    const p = allocation('2026-11-03', { a: 0.5, b: 0.5 });
    const a = { bars: [['2026-11-03', 100]] as [string, number][] };
    expect(() => computeReturns(p, { a })).toThrow('fund b has no bars');
    expect(() => computeReturns(p, { a, b: { bars: [] } })).toThrow('fund b has no bars');
    expect(() => computeReturns(p, { a, b: { bars: [['2026-11-03', 0]] } })).toThrow('not a positive number');
    expect(() => computeReturns(p, { a, b: { bars: [['3 Nov', 1]] } })).toThrow('without a date');
    expect(() => computeReturns(p, { a, b: { bars: [['2026-11-03', 1], ['2026-11-02', 1]] } })).toThrow('not strictly ascending');
    expect(() => computeReturns(p, { a, b: { bars: [['2026-11-04', 1]] } })).toThrow('no NAV on or before the anchor date');
    expect(() => computeReturns(allocation('2026-11-05', { a: 0.5, b: 0.5 }), { a, b: { bars: [['2026-11-04', 1]] } })).toThrow(
      'no date in common',
    );
  });
});
