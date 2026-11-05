import { describe, expect, it } from 'vitest';
import { formatDate, formatEuros, formatPercent, formatSignedPercent } from '../src/lib/format.ts';

describe('formatSignedPercent', () => {
  it.each([
    [0.0123, '+1.23 %'],
    [-0.0045, '−0.45 %'],
    [0, '0.00 %'],
    [-0, '0.00 %'],
    [0.00004, '0.00 %'],
    [-0.00004, '0.00 %'],
    [0.00005, '+0.01 %'],
    [-0.12345, '−12.35 %'],
    [1.5, '+150.00 %'],
  ])('%d reads %s', (x, s) => {
    expect(formatSignedPercent(x)).toBe(s);
  });

  it('uses a true minus sign, not a hyphen', () => {
    expect(formatSignedPercent(-0.01)).not.toContain('-');
  });
});

describe('formatPercent', () => {
  it.each([
    [0.9033789106, '90.34 %'],
    [0.0966210894, '9.66 %'],
    [1, '100.00 %'],
    [0.99999999, '100.00 %'],
    [0.025422678367792155, '2.54 %'],
    [0, '0.00 %'],
    [0.005, '0.50 %'],
  ])('%d reads %s', (x, s) => {
    expect(formatPercent(x)).toBe(s);
  });

  it('refuses what is not a number', () => {
    expect(() => formatPercent(Number.NaN)).toThrow();
  });
});

describe('formatDate', () => {
  it('keeps an ISO date as it is', () => {
    expect(formatDate('2026-11-03')).toBe('2026-11-03');
  });

  it('gives a Date as its UTC day', () => {
    expect(formatDate(new Date('2026-11-04T21:40:00Z'))).toBe('2026-11-04');
    expect(formatDate(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02');
  });

  it('refuses anything else', () => {
    expect(() => formatDate('03/11/2026')).toThrow();
    expect(() => formatDate(new Date('nope'))).toThrow();
  });
});

describe('formatEuros', () => {
  // U+202F between thousands, U+00A0 before the euro sign, U+2212 for minus.
  const read = (s: string) => s.replace(/\u202F/g, '_').replace(/\u00A0/g, '~');

  it.each([
    [0, '0~€', '0~€'],
    [-0, '0~€', '0~€'],
    [0.5, '1~€', '+1~€'],
    [-0.5, '−1~€', '−1~€'],
    [0.49, '0~€', '0~€'],
    [-0.49, '0~€', '0~€'],
    [999.5, '1_000~€', '+1_000~€'],
    [-999.5, '−1_000~€', '−1_000~€'],
    [999.4, '999~€', '+999~€'],
    [1234567, '1_234_567~€', '+1_234_567~€'],
    [-48.2, '−48~€', '−48~€'],
    [25312, '25_312~€', '+25_312~€'],
    [2.4999999999999996, '3~€', '+3~€'], // 2.5 as arithmetic may give it
  ])('%d reads %s as a value and %s as a change', (x, value, change) => {
    expect(read(formatEuros(x, 'value'))).toBe(value);
    expect(read(formatEuros(x, 'change'))).toBe(change);
  });

  it('never signs a positive value, always signs a change that is not zero', () => {
    expect(formatEuros(25312, 'value')).not.toMatch(/^[+−]/);
    expect(formatEuros(1, 'change')).toMatch(/^\+/);
    expect(formatEuros(-1, 'change')).toMatch(/^−/);
    expect(formatEuros(-1, 'change')).not.toContain('-');
  });

  it('refuses what is not a number', () => {
    expect(() => formatEuros(Number.NaN, 'value')).toThrow();
    expect(() => formatEuros(Number.POSITIVE_INFINITY, 'change')).toThrow();
  });
});
