// The one freshness model (ARCHITECTURE rule 3). M0 knows one state: no price snapshot yet.
// M1 adds FRESH / STALE / PARTIAL / ERROR from a snapshot and a clock passed in as arguments.

export type Freshness = { state: 'no-snapshot'; anchorDate: string };

/** The state before any price snapshot exists (M0). */
export function noSnapshot(anchorDate: string): Freshness {
  return { state: 'no-snapshot', anchorDate };
}

/** The header badge's text. */
export function badgeText(f: Freshness): string {
  return `Allocation as of ${f.anchorDate} · no prices yet`;
}

/** Whether the performance sections (tiles, chart, return columns) have numbers to show. */
export function hasPrices(f: Freshness): boolean {
  return f.state !== 'no-snapshot';
}
