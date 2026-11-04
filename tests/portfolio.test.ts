import { describe, expect, it } from 'vitest';
import { allocationOf, positionsOf, totalWeight } from '../src/lib/portfolio.ts';
import { formatPercent } from '../src/lib/format.ts';
import { funds, portfolio } from './fixtures/allocation.ts';
import catalogue from '../data/funds.json';
import realPortfolio from '../data/portfolio.json';
import type { Fund } from '../src/lib/portfolio.ts';

describe('positionsOf', () => {
  it('joins each weight to its fund and sorts heaviest first', () => {
    const rows = positionsOf(funds, portfolio);
    expect(rows.map((r) => [r.fund.id, r.weight])).toEqual([
      ['us500', 0.6],
      ['japan', 0.2],
      ['eurogov', 0.15],
      ['euroinfl', 0.05],
    ]);
  });

  it('breaks a tie in weight by short name, so the order is stable', () => {
    const tied = { ...portfolio, positions: [{ fund: 'us500', weight: 0.5 }, { fund: 'japan', weight: 0.5 }] };
    expect(positionsOf(funds, tied).map((r) => r.fund.id)).toEqual(['japan', 'us500']);
  });

  it('refuses a fund that is not in the catalogue, naming it', () => {
    const odd = { ...portfolio, positions: [{ fund: 'gold', weight: 1 }] };
    expect(() => positionsOf(funds, odd)).toThrow(/"gold"/);
  });
});

describe('allocationOf', () => {
  const a = allocationOf(positionsOf(funds, portfolio));

  it('sums the weights', () => {
    expect(a.total).toBeCloseTo(1, 12);
  });

  it('splits equities from bonds', () => {
    expect(a.equities).toBeCloseTo(0.8, 12);
    expect(a.bonds).toBeCloseTo(0.2, 12);
  });

  it('lists the asset classes heaviest first, with both names and the kind', () => {
    expect(a.byAssetClass.map((c) => [c.name, c.kind, c.weight])).toEqual([
      ['US equities', 'equity', 0.6],
      ['Japanese equities', 'equity', 0.2],
      ['Euro government bonds', 'bond', 0.15],
      ['Euro inflation-linked bonds', 'bond', 0.05],
    ]);
    expect(a.byAssetClass[0]?.nameEs).toBe('Acciones Estados Unidos');
  });

  it('adds up two funds of the same asset class', () => {
    const two: Fund[] = [...funds, { ...funds[2]!, id: 'us500b', shortName: 'US 500 bis' }];
    const p = { ...portfolio, positions: [...portfolio.positions.slice(0, 3), { fund: 'us500b', weight: 0.2 }] };
    const c = allocationOf(positionsOf(two, p)).byAssetClass;
    expect(c[0]).toMatchObject({ name: 'US equities', weight: 0.8 });
    expect(totalWeight(c)).toBeCloseTo(1, 12);
  });
});

// The committed data files: what the page shows from them (SPEC "The funds").
describe('the committed allocation', () => {
  const rows = positionsOf(catalogue as Fund[], realPortfolio);
  const a = allocationOf(rows);

  it('has eight funds, every one in the catalogue, summing to 1 within 0.0001', () => {
    expect(rows).toHaveLength(8);
    expect(Math.abs(a.total - 1)).toBeLessThan(1e-4);
    expect(formatPercent(a.total)).toBe('100.00 %');
  });

  it('reads equities 90.34 % and bonds 9.66 %', () => {
    expect(formatPercent(a.equities)).toBe('90.34 %');
    expect(formatPercent(a.bonds)).toBe('9.66 %');
  });

  it('shows the weights of the spec table, in its order', () => {
    expect(rows.map((r) => [r.fund.assetClass.en, formatPercent(r.weight)])).toEqual([
      ['US equities', '39.84 %'],
      ['European equities', '24.80 %'],
      ['Emerging-market equities', '9.30 %'],
      ['Global small caps', '9.04 %'],
      ['Japanese equities', '7.36 %'],
      ['Euro government bonds', '4.17 %'],
      ['Euro corporate bonds', '2.95 %'],
      ['Euro inflation-linked bonds', '2.54 %'],
    ]);
  });
});
