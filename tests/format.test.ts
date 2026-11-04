import { describe, expect, it } from 'vitest';
import { formatDate, formatPercent, formatSignedPercent } from '../src/lib/format.ts';

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
