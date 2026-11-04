// The one freshness model (ARCHITECTURE rule 3). Three states so far: no snapshot, a snapshot that
// cannot be read, and a loaded one with its latest date L. T-006 refines `loaded` into
// FRESH / STALE / PARTIAL from a clock passed in as an argument.
export type Freshness =
  | { state: 'no-snapshot'; anchorDate: string }
  | { state: 'unreadable'; anchorDate: string; reason: string }
  | { state: 'loaded'; anchorDate: string; latest: string; generatedAt: string; source: string };

/** There is no price snapshot (the file is not there). */
export function noSnapshot(anchorDate: string): Freshness {
  return { state: 'no-snapshot', anchorDate };
}

/** The snapshot exists but could not be loaded, parsed, or computed from. */
export function unreadable(anchorDate: string, reason: string): Freshness {
  return { state: 'unreadable', anchorDate, reason };
}

/** A snapshot was read and the returns computed; `latest` is L. */
export function loaded(anchorDate: string, latest: string, generatedAt: string, source: string): Freshness {
  return { state: 'loaded', anchorDate, latest, generatedAt, source };
}

/** `2026-11-04T22:17:37Z` as `2026-11-04 22:17 UTC`; anything else as it is. */
function snapshotTime(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

/** The header badge's text. */
export function badgeText(f: Freshness): string {
  switch (f.state) {
    case 'no-snapshot':
      return `Allocation as of ${f.anchorDate} · no prices yet`;
    case 'unreadable':
      return `Allocation as of ${f.anchorDate} · prices unreadable · ERROR`;
    case 'loaded':
      return `NAV as of ${f.latest} · snapshot ${snapshotTime(f.generatedAt)}`;
  }
}

/** Whether the performance sections (tiles, chart, return columns) have numbers to show. */
export function hasPrices(f: Freshness): boolean {
  return f.state === 'loaded';
}
