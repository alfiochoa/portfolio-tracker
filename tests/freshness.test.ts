import { describe, expect, it } from 'vitest';
import { badgeText, hasPrices, noSnapshot } from '../src/lib/freshness.ts';

describe('the badge with no snapshot yet', () => {
  it('names the allocation date and says prices are not wired', () => {
    expect(badgeText(noSnapshot('2026-11-04'))).toBe('Allocation as of 2026-11-04 · no prices yet');
  });

  it('tells the performance sections there is nothing to show', () => {
    expect(hasPrices(noSnapshot('2026-11-04'))).toBe(false);
  });
});
