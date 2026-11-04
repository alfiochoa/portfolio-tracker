import { describe, expect, it } from 'vitest';
import { badgeText, hasPrices, loaded, noSnapshot, unreadable } from '../src/lib/freshness.ts';

describe('the badge with no snapshot yet', () => {
  it('names the allocation date and says prices are not wired', () => {
    expect(badgeText(noSnapshot('2026-11-04'))).toBe('Allocation as of 2026-11-04 · no prices yet');
  });

  it('tells the performance sections there is nothing to show', () => {
    expect(hasPrices(noSnapshot('2026-11-04'))).toBe(false);
  });
});

describe('the badge once a snapshot has been fetched', () => {
  it('names L and the snapshot time when it was read', () => {
    const f = loaded('2026-11-04', '2026-11-03', '2026-11-04T22:17:37Z', 'Yahoo Finance (unofficial)');
    expect(badgeText(f)).toBe('NAV as of 2026-11-03 · snapshot 2026-11-04 22:17 UTC');
    expect(hasPrices(f)).toBe(true);
  });

  it('says ERROR, and has no prices, when it could not be read', () => {
    const f = unreadable('2026-11-04', 'not JSON');
    expect(badgeText(f)).toBe('Allocation as of 2026-11-04 · prices unreadable · ERROR');
    expect(hasPrices(f)).toBe(false);
  });
});
