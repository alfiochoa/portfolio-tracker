// The euro amounts (SPEC "Euro amounts"), against values worked out by hand from the literal
// three-fund fixture of tests/fixtures/returns.ts, and the two sums that must hold on any data.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeEuros, isStoredTotal, MAX_EUROS, parseEuros, parseStoredTotal, type Euros } from '../src/lib/euros.ts';
import type { Portfolio } from '../src/lib/portfolio.ts';
import { computeReturns } from '../src/lib/returns.ts';
import { parseSnapshot } from '../src/lib/snapshot.ts';
import { columns, three } from './fixtures/returns.ts';

const DIGITS = 9;

function carried(e: Euros): Extract<Euros, { kind: 'carried' }> {
  if (e.kind !== 'carried') throw new Error(`not carried: ${e.kind}`);
  return e;
}

const sum = (xs: Record<string, number>) => Object.values(xs).reduce((a, b) => a + b, 0);

/*
 * The three-fund fixture: weights a 0.5, b 0.3, c 0.2, anchor T = 2026-10-30, where the NAVs are
 * a 12.5, b 19, c 42; so V(t) = 0.5·a/12.5 + 0.3·b/19 + 0.2·c/42.
 *
 *   L = 2026-11-03 (a 13.5, b 19.5, c 43): V(L) = 0.54 + 5.85/19 + 8.6/42
 *   D = 2026-11-02 (a 13,   b 19,   c 42): V(D) = 0.52 + 0.3 + 0.2 = 1.02
 *
 * With 10 200 € typed on D: E = 10 200 · V(L)/1.02 = 10 000 · V(L) = 5 400 + 58 500/19 + 86 000/42.
 * E_i = E · w_i · P_i(L)/P_i(T) / V(L) = 10 000 · w_i · P_i(L)/P_i(T):
 *   a 10 000 · 0.5 · 13.5/12.5 = 5 400;  b 10 000 · 0.3 · 19.5/19 = 58 500/19;  c 10 000 · 0.2 · 43/42 = 86 000/42.
 * Over 1d (S = D): the portfolio's change is E − E · V(D)/V(L) = E − 10 200; by fund E_i − E_i · P_i(S)/P_i(L):
 *   a 5 400 − 5 400 · 13/13.5 = 200;  b 58 500/19 − 3 000;  c 86 000/42 − 2 000.
 */
describe('the three-fund fixture, by hand', () => {
  const returns = computeReturns(three.portfolio, three.funds);
  const vL = 0.54 + 5.85 / 19 + 8.6 / 42;
  const E = 5400 + 58500 / 19 + 86000 / 42;

  it('carries the total typed on D to L as the value index moves', () => {
    const e = carried(computeEuros(three.portfolio, three.funds, returns, { euros: 10200, asOf: '2026-11-02' }));
    expect(e.latest).toBe('2026-11-03');
    expect(e.worth).toBeCloseTo(E, DIGITS);
    expect(e.worth).toBeCloseTo((10200 * vL) / 1.02, DIGITS);
  });

  it('is the amount typed when D is L', () => {
    const e = carried(computeEuros(three.portfolio, three.funds, returns, { euros: 25000, asOf: '2026-11-03' }));
    expect(e.worth).toBeCloseTo(25000, DIGITS);
  });

  it('carries backwards too: a total typed on the anchor date (V = 1)', () => {
    const e = carried(computeEuros(three.portfolio, three.funds, returns, { euros: 10000, asOf: '2026-10-30' }));
    expect(e.worth).toBeCloseTo(10000 * vL, DIGITS);
  });

  it('splits E by fund after the drift since the anchor, and the funds sum to E', () => {
    const e = carried(computeEuros(three.portfolio, three.funds, returns, { euros: 10200, asOf: '2026-11-02' }));
    expect(e.funds.a).toBeCloseTo(5400, DIGITS);
    expect(e.funds.b).toBeCloseTo(58500 / 19, DIGITS);
    expect(e.funds.c).toBeCloseTo(86000 / 42, DIGITS);
    expect(sum(e.funds)).toBeCloseTo(e.worth, DIGITS);
  });

  it("gives each window's change, and the fund changes sum to the portfolio's", () => {
    const e = carried(computeEuros(three.portfolio, three.funds, returns, { euros: 10200, asOf: '2026-11-02' }));
    const d1 = e.windows[0]!;
    if (!d1.enough) throw new Error('1d has a start');
    expect(d1.portfolio).toBeCloseTo(E - 10200, DIGITS);
    expect(d1.funds.a).toBeCloseTo(200, DIGITS);
    expect(d1.funds.b).toBeCloseTo(58500 / 19 - 3000, DIGITS);
    expect(d1.funds.c).toBeCloseTo(86000 / 42 - 2000, DIGITS);
    for (const w of e.windows) {
      if (!w.enough) throw new Error(`${w.window} has a start in this fixture`);
      expect(sum(w.funds)).toBeCloseTo(w.portfolio, DIGITS);
    }
  });

  it('gives a change the sign of its return', () => {
    const e = carried(computeEuros(three.portfolio, three.funds, returns, { euros: 10200, asOf: '2026-11-02' }));
    returns.windows.forEach((r, i) => {
      const w = e.windows[i]!;
      if (!r.enough || !w.enough) throw new Error('every window has a start here');
      expect(Math.sign(w.portfolio)).toBe(Math.sign(r.portfolio));
      for (const id of ['a', 'b', 'c']) expect(Math.sign(w.funds[id]!)).toBe(Math.sign(r.funds[id]!));
    });
  });

  it('reports a date that is not in the series, and whether it is older than the history', () => {
    const at = (asOf: string) => computeEuros(three.portfolio, three.funds, returns, { euros: 10000, asOf });
    expect(at('2026-05-02')).toEqual({ kind: 'not-in-series', entered: { euros: 10000, asOf: '2026-05-02' }, older: true });
    // A Saturday inside the series, and a date after L: not in it, not older.
    expect(at('2026-10-31')).toMatchObject({ kind: 'not-in-series', older: false });
    expect(at('2026-11-04')).toMatchObject({ kind: 'not-in-series', older: false });
  });
});

describe('a short history', () => {
  // Six dates: 1d, 5d and 1w have a start, 1m and 2m do not.
  const portfolio: Portfolio = { ...three.portfolio, anchorDate: '2026-11-03' };
  const funds = columns(
    ['a', 'b', 'c'],
    [
      ['2026-10-27', 12, 18, 42],
      ['2026-10-28', 12, 18.5, 42],
      ['2026-10-29', 12.5, 18.5, 42.5],
      ['2026-10-30', 12.5, 19, 42],
      ['2026-11-02', 13, 19, 42],
      ['2026-11-03', 13.5, 19.5, 43],
    ],
  );
  const returns = computeReturns(portfolio, funds);

  it('has no amount for a window that is not enough, and amounts for the others', () => {
    const e = carried(computeEuros(portfolio, funds, returns, { euros: 1000, asOf: '2026-11-03' }));
    expect(e.windows.map((w) => [w.window, w.enough])).toEqual([
      ['1d', true],
      ['5d', true],
      ['1w', true],
      ['1m', false],
      ['2m', false],
    ]);
    expect(e.windows[3]).toEqual({ window: '1m', enough: false });
    // T = L: the funds are worth their weights. 5d: S = 2026-10-27, a 1000·0.5·(1 − 12/13.5).
    expect(e.funds.a).toBeCloseTo(500, DIGITS);
    const d5 = e.windows[1]!;
    if (!d5.enough) throw new Error('5d has a start');
    expect(d5.funds.a).toBeCloseTo(500 * (1 - 12 / 13.5), DIGITS);
  });
});

describe('the eight funds of the e2e fixture', () => {
  const root = path.join(import.meta.dirname, '..');
  const portfolio = JSON.parse(readFileSync(path.join(root, 'data', 'portfolio.json'), 'utf8')) as Portfolio;
  const snapshot = parseSnapshot(readFileSync(path.join(root, 'e2e', 'fixtures', 'prices.json'), 'utf8'));
  const returns = computeReturns(portfolio, snapshot.funds);

  it('sums the eight fund values to E and the eight fund changes to the portfolio change, before rounding', () => {
    for (const asOf of [returns.latest, returns.dates[0]!, returns.dates[returns.dates.length - 3]!]) {
      const e = carried(computeEuros(portfolio, snapshot.funds, returns, { euros: 123457, asOf }));
      expect(Object.keys(e.funds)).toHaveLength(8);
      expect(sum(e.funds)).toBeCloseTo(e.worth, DIGITS);
      for (const w of e.windows) if (w.enough) expect(sum(w.funds)).toBeCloseTo(w.portfolio, DIGITS);
    }
  });

  it('reports a dropped date as not in the series', () => {
    // us500 alone has 2026-10-26 in the fixture, so the series drops it.
    expect(returns.dropped).toContain('2026-10-26');
    expect(computeEuros(portfolio, snapshot.funds, returns, { euros: 1000, asOf: '2026-10-26' })).toMatchObject({ kind: 'not-in-series', older: false });
  });
});

describe('the stored value and what is typed', () => {
  it('reads a stored total, and treats anything else as absent', () => {
    expect(parseStoredTotal('{"euros":25000,"asOf":"2026-11-03"}')).toEqual({ euros: 25000, asOf: '2026-11-03' });
    expect(parseStoredTotal('{"euros":25000,"asOf":"2026-11-03","extra":1}')).toEqual({ euros: 25000, asOf: '2026-11-03' });
    for (const bad of [null, '', 'nope', '25000', '{"euros":0,"asOf":"2026-11-03"}', '{"euros":-5,"asOf":"2026-11-03"}', '{"euros":2.5,"asOf":"2026-11-03"}', '{"euros":"25000","asOf":"2026-11-03"}', '{"euros":25000,"asOf":"03/11/2026"}', '{"euros":25000}', '{"euros":25000,"asOf":"2026-13-45"}']) {
      expect(parseStoredTotal(bad), String(bad)).toBeNull();
    }
    expect(isStoredTotal({ euros: 1, asOf: '2026-11-03' })).toBe(true);
    expect(isStoredTotal({ euros: 10_000_000, asOf: '2026-11-03' })).toBe(true);
    expect(parseStoredTotal('{"euros":10000001,"asOf":"2026-11-03"}')).toBeNull();
    expect(parseStoredTotal('{"euros":1000000000,"asOf":"2026-11-03"}')).toBeNull();
    expect(parseStoredTotal('{"euros":9007199254740991,"asOf":"2026-11-03"}')).toBeNull();
  });

  it('takes a whole number of euros from 1 to ten million, and nothing else', () => {
    expect(parseEuros('25000')).toBe(25000);
    expect(parseEuros(' 1 ')).toBe(1);
    expect(parseEuros('10000000')).toBe(MAX_EUROS);
    for (const bad of ['', '0', '-5', '25.5', '25,000', '25.000,50', '1e3', 'abc', '10000001', '1000000000', '9007199254740991', '99999999999999999999']) expect(parseEuros(bad), bad).toBeNull();
  });
});
