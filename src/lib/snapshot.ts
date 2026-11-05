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
  /**
   * Vanguard's product page this run: on success, the dates its bars cover (they are the fund's
   * bars from `from` to `to`, `bars` of them, Vanguard's values) and when they were fetched (kept
   * when a later run gets the same bars); on failure, why. Absent in files from before M2.
   */
  vanguard?: VanguardEntry;
}

export type VanguardEntry = { fetchedAt: string; from: string; to: string; bars: number } | { error: string };

export interface Snapshot {
  generatedAt: string;
  source: { name: string; kind: string };
  state: SnapshotState;
  /** Why the run was `partial` or `failed`. */
  error?: string;
  /** A run that is `ok` but could not reach Vanguard for some funds: which, and why. */
  warning?: string;
  funds: Record<string, FundPrices>;
}

export const SOURCE = { name: 'Vanguard (official) + Yahoo Finance (unofficial)', kind: 'vanguard+yahoo' } as const;

/** A shared date on which Yahoo and Vanguard differ by more than this is reported. */
export const DIFFERENCE_TOLERANCE = 0.00005;

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

/** What one source gave for one fund this run. */
export type SourceResult = { ok: true; bars: Bar[] } | { ok: false; reason: string };

/**
 * What this run got for one fund: Yahoo's answer (`ok`, with the currency and bars, or the
 * reason), and Vanguard's (absent when the fund has no Vanguard page in the catalogue).
 */
export type FundResult = (
  | { id: string; ok: true; currency: string; bars: Bar[] }
  | { id: string; ok: false; reason: string }
) & { vanguard?: SourceResult };

/** `over` laid on `base`: on a date both have, `over`'s value; a date only `over` has, inserted in order. */
export function overlayBars(base: readonly Bar[], over: readonly Bar[]): Bar[] {
  const byDate = new Map<string, number>(base);
  for (const [date, nav] of over) byDate.set(date, nav);
  return [...byDate].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * `fresh` with `previous`'s bar added on each date after `fresh`'s first that `fresh` lacks, inside
 * its span or after its last date: a date Vanguard once filled (2026-10-26, which Yahoo never had)
 * stays when it leaves Vanguard's ten, and a NAV Vanguard published once (2026-11-04, past Yahoo's
 * last bar) stays when its page omits it again, so a fund's latest date never steps back. `fresh`
 * wins wherever it has a value; dates on or before its first are not carried (the window slides).
 */
export function carryForward(fresh: readonly Bar[], previous: readonly Bar[]): Bar[] {
  if (fresh.length === 0) return [...fresh];
  const first = fresh[0]![0];
  const have = new Set(fresh.map(([d]) => d));
  const carried = previous.filter(([d]) => d > first && !have.has(d));
  return carried.length ? overlayBars(carried, fresh) : [...fresh];
}

/** The dates both have on which the two values differ by more than DIFFERENCE_TOLERANCE. */
export function differences(yahoo: readonly Bar[], vanguard: readonly Bar[]): { date: string; yahoo: number; vanguard: number }[] {
  const y = new Map<string, number>(yahoo);
  return vanguard.flatMap(([date, v]) => {
    const yv = y.get(date);
    return yv !== undefined && Math.abs(yv - v) > DIFFERENCE_TOLERANCE ? [{ date, yahoo: yv, vanguard: v }] : [];
  });
}

export type Outcome =
  | { write: true; snapshot: Snapshot }
  /** Nothing to write: a fund failed and there is no previous file to keep its bars from. */
  | { write: false; error: string };

const sameBars = (a: readonly Bar[], b: readonly Bar[]): boolean =>
  a.length === b.length && a.every(([d, v], i) => d === b[i]![0] && v === b[i]![1]);

/** Every bar of `some` is in `all`, with the same value. */
const sameValues = (all: readonly Bar[], some: readonly Bar[]): boolean => {
  const byDate = new Map<string, number>(all);
  return some.every(([d, v]) => byDate.get(d) === v);
};

/**
 * Merge one run's results (one per fund, in catalogue order) with the previous snapshot.
 *
 * Per fund, the base is Yahoo's bars from this run, with the previous file's value carried on each
 * date after their first that they lack, inside their span or after it (carryForward: a hole once
 * filled stays filled, a latest date never steps back), or, when Yahoo failed, the previous file's
 * bars (`kept: true`, `error`); Vanguard's bars are laid over it (overlayBars: Vanguard wins over
 * both on its dates) and recorded in `vanguard`, or Vanguard's failure is. An entry whose bars, currency and Vanguard bars are what
 * the previous file has keeps its times, so a second run on the same answers changes only
 * `generatedAt`. A Vanguard answer that steps back (its last date before the previous entry's `to`,
 * every value already in the previous bars) brings nothing new: the previous entry is kept, since
 * its dates are still Vanguard's values in the file, so a page that briefly omits its newest day
 * changes only `generatedAt`.
 *
 * - Every fund's Yahoo bars refreshed: `state: "ok"`, with a `warning` naming the funds Vanguard failed for.
 * - Some fund's Yahoo bars kept from the previous file: `state: "partial"` and `error`, whatever Vanguard did.
 * - No fund got bars from either source: the previous file, unchanged but for `generatedAt`,
 *   `state: "failed"` and `error`.
 * - Yahoo failed for a fund the previous file does not have: nothing is written.
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

  if (previous && failures.length === results.length && !results.some((r) => r.vanguard?.ok)) {
    const both = failures.map((f) => `${f.id}: ${f.reason}${f.vanguard && !f.vanguard.ok ? ` (vanguard: ${f.vanguard.reason})` : ''}`).join('; ');
    const snapshot: Snapshot = { ...previous, generatedAt, state: 'failed', error: `every fund failed: ${both}` };
    delete snapshot.warning; // the previous run's, about bars this run did not get
    return { write: true, snapshot };
  }

  const funds: Record<string, FundPrices> = {};
  const vanguardFailures: string[] = [];
  for (const r of results) {
    const before = previous?.funds[r.id];
    const currency = r.ok ? r.currency : before!.currency;
    let bars = r.ok ? carryForward(r.bars, before?.bars ?? []) : before!.bars;
    let vanguard: VanguardEntry | undefined;
    if (r.vanguard?.ok) {
      const v = r.vanguard.bars;
      const merged = overlayBars(bars, v);
      try {
        validateBars(merged);
        bars = merged;
        const was = before?.vanguard;
        const known = was && 'fetchedAt' in was && sameValues(before.bars, v) ? was : undefined;
        const from = v[0]![0];
        const to = v.at(-1)![0];
        if (known && to < known.to && sameValues(bars, before!.bars.filter(([d]) => d >= known.from && d <= known.to))) {
          vanguard = known; // an older view of the page: the newer ten it gave before are still in the bars
        } else {
          const same = known && known.from === from && known.to === to && known.bars === v.length;
          vanguard = { fetchedAt: same ? known.fetchedAt : generatedAt, from, to, bars: v.length };
        }
      } catch (e) {
        vanguard = { error: `not laid over: ${(e as Error).message}` };
      }
    } else if (r.vanguard) {
      vanguard = { error: r.vanguard.reason };
    }
    if (vanguard && 'error' in vanguard) vanguardFailures.push(`${r.id}: ${vanguard.error}`);

    let entry: FundPrices;
    if (!r.ok) {
      entry = { currency, fetchedAt: before!.fetchedAt, bars, kept: true, error: r.reason };
    } else if (before && !before.kept && before.currency === currency && sameBars(before.bars, bars)) {
      entry = { currency, fetchedAt: before.fetchedAt, bars };
    } else {
      entry = { currency, fetchedAt: generatedAt, bars };
    }
    if (vanguard) entry.vanguard = vanguard;
    funds[r.id] = entry;
  }
  const snapshot: Snapshot = { generatedAt, source: { ...SOURCE }, state: failures.length ? 'partial' : 'ok', funds };
  if (failures.length) snapshot.error = `${failures.length} of ${results.length} funds kept from the previous snapshot: ${reasons}`;
  else if (vanguardFailures.length) {
    snapshot.warning = `Vanguard failed for ${vanguardFailures.length} of ${results.length} funds; their newest days come from Yahoo and the previous file: ${vanguardFailures.join('; ')}`;
  }
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
  if (s.warning !== undefined) head.push(`  "warning": ${j(s.warning)},`);
  const funds = Object.entries(s.funds).map(([id, f]) => {
    const lines = [`    ${j(id)}: {`, `      "currency": ${j(f.currency)},`, `      "fetchedAt": ${j(f.fetchedAt)},`];
    if (f.kept) lines.push(`      "kept": true,`);
    if (f.error !== undefined) lines.push(`      "error": ${j(f.error)},`);
    if (f.vanguard !== undefined) lines.push(`      "vanguard": ${j(f.vanguard)},`);
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
  if (s.warning !== undefined && typeof s.warning !== 'string') throw new Error('the snapshot\'s warning is not text');
  for (const [id, f] of Object.entries(s.funds)) {
    if (!Array.isArray(f.bars) || typeof f.fetchedAt !== 'string' || typeof f.currency !== 'string') {
      throw new Error(`fund ${id} has no bars, fetchedAt or currency`);
    }
    if (f.vanguard !== undefined && (typeof f.vanguard !== 'object' || f.vanguard === null)) {
      throw new Error(`fund ${id}'s vanguard entry is not an object`);
    }
  }
  return s;
}
