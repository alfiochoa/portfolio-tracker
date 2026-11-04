// The snapshot, public/data/prices.json: its shape, the checks a fund's bars must pass, how one
// run's results are merged with the previous file (fail closed, keep what we had), and its text.
// Pure: no I/O, no clock; `now` is passed in.
import type { Bar } from './yahoo.ts';

export type SnapshotState = 'ok' | 'partial' | 'failed';

export interface FundPrices {
  currency: string;
  /** When these bars were fetched. A later run that fetches the same bars keeps this time. */
  fetchedAt: string;
  /** `[date, nav]`, the NAV date, ascending, no nulls. */
  bars: Bar[];
  /** Present (true) when this run could not refresh the fund and its previous bars were kept. */
  kept?: true;
  /** Why the fund could not be refreshed (with `kept`). */
  error?: string;
}

export interface Snapshot {
  generatedAt: string;
  source: { name: string; kind: string };
  state: SnapshotState;
  /** Why the run was `partial` or `failed`. */
  error?: string;
  funds: Record<string, FundPrices>;
}

export const SOURCE = { name: 'Yahoo Finance (unofficial)', kind: 'yahoo' } as const;

/** A fund needs this many bars: about three months of working days. */
export const MIN_BARS = 60;
/** No more than this many calendar days between consecutive bars (a long Easter is five). */
export const MAX_GAP_DAYS = 7;

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** A fund's bars are usable. Throws an Error whose message is the reason; returns the latest date. */
export function validateBars(bars: readonly Bar[]): { latest: string } {
  if (bars.length < MIN_BARS) throw new Error(`only ${bars.length} bars, at least ${MIN_BARS} needed`);
  for (let i = 1; i < bars.length; i++) {
    const [from] = bars[i - 1]!;
    const [to] = bars[i]!;
    const gap = daysBetween(from, to);
    if (gap <= 0) throw new Error(`the bars are not strictly ascending: ${to} follows ${from}`);
    if (gap > MAX_GAP_DAYS) throw new Error(`a gap of ${gap} days between ${from} and ${to} (at most ${MAX_GAP_DAYS})`);
  }
  return { latest: bars.at(-1)![0] };
}

/** What this run got for one fund. */
export type FundResult =
  | { id: string; ok: true; currency: string; bars: Bar[] }
  | { id: string; ok: false; reason: string };

export type Outcome =
  | { write: true; snapshot: Snapshot }
  /** Nothing to write: a fund failed and there is no previous file to keep its bars from. */
  | { write: false; error: string };

const sameBars = (a: readonly Bar[], b: readonly Bar[]): boolean =>
  a.length === b.length && a.every(([d, v], i) => d === b[i]![0] && v === b[i]![1]);

/**
 * Merge one run's results (one per fund, in catalogue order) with the previous snapshot.
 *
 * - Every fund ok: `state: "ok"`. A fund whose bars and currency are what the previous file has
 *   keeps its previous entry, `fetchedAt` included, so a second run changes only `generatedAt`.
 * - Some funds failed: each keeps its previous entry with `kept: true` and `error`; `state: "partial"`.
 * - Every fund failed: the previous file, unchanged but for `generatedAt`, `state: "failed"` and `error`.
 * - A fund failed and the previous file has no entry for it: nothing is written.
 */
export function mergeRun(previous: Snapshot | null, results: readonly FundResult[], now: Date): Outcome {
  const generatedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const failures = results.filter((r): r is Extract<FundResult, { ok: false }> => !r.ok);
  const reasons = failures.map((f) => `${f.id}: ${f.reason}`).join('; ');

  const orphans = failures.filter((f) => !previous?.funds[f.id]);
  if (orphans.length > 0) {
    const which = orphans.map((f) => f.id).join(', ');
    return {
      write: false,
      error: previous
        ? `no previous bars to keep for ${which} (${reasons})`
        : `no previous snapshot to keep, and ${which} failed (${reasons})`,
    };
  }

  if (previous && failures.length === results.length) {
    return { write: true, snapshot: { ...previous, generatedAt, state: 'failed', error: `every fund failed: ${reasons}` } };
  }

  const funds: Record<string, FundPrices> = {};
  for (const r of results) {
    const before = previous?.funds[r.id];
    if (!r.ok) {
      funds[r.id] = { currency: before!.currency, fetchedAt: before!.fetchedAt, bars: before!.bars, kept: true, error: r.reason };
    } else if (before && !before.kept && before.currency === r.currency && sameBars(before.bars, r.bars)) {
      funds[r.id] = { currency: before.currency, fetchedAt: before.fetchedAt, bars: before.bars };
    } else {
      funds[r.id] = { currency: r.currency, fetchedAt: generatedAt, bars: r.bars };
    }
  }
  const snapshot: Snapshot = { generatedAt, source: { ...SOURCE }, state: failures.length ? 'partial' : 'ok', funds };
  if (failures.length) snapshot.error = `${failures.length} of ${results.length} funds kept from the previous snapshot: ${reasons}`;
  return { write: true, snapshot };
}

/**
 * The snapshot's text: indented JSON with one bar per line, so a daily refresh reads as a short
 * diff (`generatedAt`, a bar gone from the top and one added at the end of each fund). The same
 * snapshot always renders to the same text.
 */
export function renderSnapshot(s: Snapshot): string {
  const j = JSON.stringify;
  const head = [`  "generatedAt": ${j(s.generatedAt)},`, `  "source": ${j(s.source)},`, `  "state": ${j(s.state)},`];
  if (s.error !== undefined) head.push(`  "error": ${j(s.error)},`);
  const funds = Object.entries(s.funds).map(([id, f]) => {
    const lines = [`    ${j(id)}: {`, `      "currency": ${j(f.currency)},`, `      "fetchedAt": ${j(f.fetchedAt)},`];
    if (f.kept) lines.push(`      "kept": true,`);
    if (f.error !== undefined) lines.push(`      "error": ${j(f.error)},`);
    lines.push(`      "bars": [`, f.bars.map((b) => `        ${j(b)}`).join(',\n'), '      ]', '    }');
    return lines.join('\n');
  });
  return ['{', ...head, '  "funds": {', funds.join(',\n'), '  }', '}', ''].join('\n');
}

const STATES: readonly string[] = ['ok', 'partial', 'failed'] satisfies SnapshotState[];

/** An ISO 8601 instant with a time and a zone (`2026-11-04T21:45:00Z`), one `Date.parse` accepts. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The string is an ISO instant on a real calendar date. `Date.parse` alone is not enough: V8 rolls
 * `2026-02-30` into March, so the month and the day are checked against that month's length.
 */
function isIsoInstant(text: string): boolean {
  if (!ISO_INSTANT.test(text) || Number.isNaN(Date.parse(text))) return false;
  const [year, month, day] = text.slice(0, 10).split('-').map(Number) as [number, number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}

/** Read a snapshot's text; throws, with the reason, when it is not one. */
export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (typeof s !== 'object' || s === null || typeof s.funds !== 'object' || s.funds === null || typeof s.generatedAt !== 'string') {
    throw new Error('not a snapshot (no generatedAt or funds)');
  }
  if (!isIsoInstant(s.generatedAt)) {
    throw new Error(`the snapshot's generatedAt is not an ISO time: ${JSON.stringify(s.generatedAt)}`);
  }
  if (!STATES.includes(s.state)) {
    throw new Error(`the snapshot's state is not ok, partial or failed: ${JSON.stringify(s.state ?? null)}`);
  }
  if (typeof s.source !== 'object' || s.source === null || typeof s.source.name !== 'string') {
    throw new Error('the snapshot does not name its source');
  }
  for (const [id, f] of Object.entries(s.funds)) {
    if (!Array.isArray(f.bars) || typeof f.fetchedAt !== 'string' || typeof f.currency !== 'string') {
      throw new Error(`fund ${id} has no bars, fetchedAt or currency`);
    }
  }
  return s;
}
