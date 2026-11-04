// The one freshness model (ARCHITECTURE rule 3, SPEC "Freshness states"). From what came of
// loading the snapshot, the series facts the returns were computed with, and a clock passed in as
// an argument, it says which states the page is in (FRESH or STALE, PARTIAL on top; ERROR), the
// badge's text and the lines of its detail. Every section takes its state from here.
// Pure: no DOM, no I/O; `now` and (for tests) the viewer's time zone are arguments.
import { chartStart } from './chart.ts';
import type { Returns } from './returns.ts';
import type { Snapshot } from './snapshot.ts';

export type BadgeState = 'FRESH' | 'STALE' | 'PARTIAL' | 'ERROR';

/** The state colour's role: the `--ok`, `--warn` and `--error` tokens; `none` while there is nothing to judge. */
export type Tone = 'ok' | 'warn' | 'error' | 'none';

/** What the badge needs to know of the snapshot itself. */
export type SnapshotMeta = Pick<Snapshot, 'generatedAt' | 'source' | 'state' | 'error' | 'warning'>;

/** The series facts PARTIAL is judged on (see seriesFacts). */
export interface SeriesFacts {
  /** L, the last date of the portfolio series. */
  latest: string;
  /** Each portfolio fund's latest NAV date, in portfolio order; null when the fund has no bars. */
  fundLatest: Record<string, string | null>;
  /** Dates dropped from the portfolio series (some fund has no NAV) inside the 2m window, ascending. */
  droppedIn2m: string[];
}

/** What came of loading the snapshot. */
export type PricesOutcome =
  /** The fetch has not settled yet. */
  | { kind: 'loading' }
  /** There is no snapshot file (a 404). */
  | { kind: 'missing' }
  /** It could not be loaded, parsed or computed from; `snapshot` when it parsed but the returns could not be computed. */
  | { kind: 'unreadable'; reason: string; snapshot?: SnapshotMeta }
  | { kind: 'loaded'; snapshot: SnapshotMeta; facts: SeriesFacts };

export interface FreshnessInput {
  /** T, the allocation's date. */
  anchorDate: string;
  prices: PricesOutcome;
  /** The one clock (src/main.ts). */
  now: Date;
  /** The viewer's IANA time zone; the system's when absent. Tests pass one. */
  timeZone?: string;
  /** A fund's name for the detail lines, by id; the id when absent. */
  names?: Readonly<Record<string, string>>;
}

export interface Freshness {
  /** Which sections have numbers: `loaded` is the only state with returns. */
  state: 'loading' | 'no-snapshot' | 'unreadable' | 'loaded';
  /** The SPEC's states, in the order the badge says them; empty while loading or with no snapshot. */
  states: BadgeState[];
  tone: Tone;
  /** The badge's own text: `NAV as of <L> · snapshot <time> · <STATE>`, then ` · run partial` or ` · run failed` when the snapshot run was not ok. */
  text: string;
  /** The snapshot run's own state when it was not `ok` (loaded only; the badge says it after the states). */
  run?: 'partial' | 'failed';
  /** The detail the badge opens on hover or tap, one line each. */
  details: string[];
  anchorDate: string;
  /** L, when loaded. */
  latest?: string;
  /** The snapshot's source name and build time, when it was read. */
  source?: string;
  generatedAt?: string;
}

/** The source the snapshot script uses, named before any snapshot exists. */
const DEFAULT_SOURCE = 'Vanguard (official) + Yahoo Finance (unofficial)';

/**
 * PARTIAL's facts, from the returns and the snapshot's funds: L, each portfolio fund's latest
 * date, and the dates the series dropped between the chart's start (the 2m window's S, or the
 * series' first date when it does not reach that far) and L.
 */
export function seriesFacts(
  returns: Pick<Returns, 'latest' | 'dates' | 'dropped' | 'windows'>,
  fundIds: readonly string[],
  funds: Readonly<Record<string, { bars: readonly (readonly [string, number])[] } | undefined>>,
): SeriesFacts {
  const fundLatest: Record<string, string | null> = {};
  for (const id of fundIds) fundLatest[id] = funds[id]?.bars.at(-1)?.[0] ?? null;
  const from = chartStart(returns) ?? returns.latest;
  return { latest: returns.latest, fundLatest, droppedIn2m: returns.dropped.filter((d) => d >= from && d <= returns.latest) };
}

const DAY_MS = 86_400_000;
const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const weekday = (date: string): number => new Date(toUtc(date)).getUTCDay(); // 0 Sunday … 6 Saturday
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `now`'s calendar date in the viewer's time zone (the only place the zone matters to a rule). */
export function viewerDate(now: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The oldest NAV date that is still FRESH on `today`: two weekdays before it, a Saturday or a
 * Sunday counting as the Monday after. From a Monday, the Thursday before; from a Wednesday, the Monday.
 */
export function freshFrom(today: string): string {
  let ms = toUtc(today);
  const dow = weekday(today);
  if (dow === 6) ms += 2 * DAY_MS;
  if (dow === 0) ms += DAY_MS;
  for (let left = 2; left > 0; ) {
    ms -= DAY_MS;
    const d = new Date(ms).getUTCDay();
    if (d !== 0 && d !== 6) left--;
  }
  return fromUtc(ms);
}

/** `2026-11-04T22:17:37Z` as `2026-11-04 22:17 UTC`; anything else as it is. */
export function utcTime(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

/** The same instant in the viewer's time zone: `2026-11-04 07:30 CET`; the text as it is when it is not a time. */
export function localTime(iso: string, timeZone?: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(new Date(t));
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`.trimEnd();
}

/** The snapshot's source and build time, in UTC and in the viewer's time. */
function snapshotLines(s: SnapshotMeta, timeZone?: string): string[] {
  return [
    `Source: ${s.source?.name || DEFAULT_SOURCE}`,
    `Snapshot built ${utcTime(s.generatedAt)} (${localTime(s.generatedAt, timeZone)} your time)`,
  ];
}

/**
 * The snapshot run's own state, when it is not `ok`, with the reason the script recorded; then the
 * run's warning, when it has one (Vanguard failed for some funds: their newest days are Yahoo's
 * alone, so unofficial, but complete and current, which is why it changes no state or colour).
 */
function runLines(s: SnapshotMeta): string[] {
  const lines: string[] = [];
  if (s.state === 'partial') lines.push(`The snapshot run was partial: ${s.error ?? 'no reason recorded'}`);
  if (s.state === 'failed') lines.push(`The last snapshot run failed, so these are the previous prices: ${s.error ?? 'no reason recorded'}`);
  if (s.warning) lines.push(`Warning: ${s.warning}`);
  return lines;
}

function error(anchorDate: string, reason: string, snapshot: SnapshotMeta | undefined, timeZone?: string): Freshness {
  return {
    state: 'unreadable',
    states: ['ERROR'],
    tone: 'error',
    text: `Allocation as of ${anchorDate} · prices unreadable · ERROR`,
    details: [
      `ERROR: ${reason}`,
      ...(snapshot ? [...snapshotLines(snapshot, timeZone), ...runLines(snapshot)] : []),
      'No returns are shown. The allocation and the positions come from the export and still show.',
    ],
    anchorDate,
    source: snapshot?.source?.name,
    generatedAt: snapshot?.generatedAt,
  };
}

/** The page's freshness: its states, the badge's text and colour, and the detail lines. */
export function assessFreshness({ anchorDate, prices, now, timeZone, names = {} }: FreshnessInput): Freshness {
  switch (prices.kind) {
    case 'loading':
      return {
        state: 'loading',
        states: [],
        tone: 'none',
        text: `Allocation as of ${anchorDate} · loading prices…`,
        details: ['Loading the price snapshot.'],
        anchorDate,
      };
    case 'missing':
      return {
        state: 'no-snapshot',
        states: [],
        tone: 'none',
        text: `Allocation as of ${anchorDate} · no prices yet`,
        details: [
          'No price snapshot has been built yet, so there are no returns to show.',
          `Prices will come from ${DEFAULT_SOURCE}, once a day, through npm run snapshots.`,
        ],
        anchorDate,
      };
    case 'unreadable':
      return error(anchorDate, prices.reason, prices.snapshot, timeZone);
    case 'loaded':
      break;
  }

  const { snapshot, facts } = prices;
  const bare = Object.entries(facts.fundLatest).filter(([, d]) => d === null).map(([id]) => id);
  if (bare.length > 0) {
    const which = bare.map((id) => names[id] ?? id).join(', ');
    return error(anchorDate, `${which} ${bare.length === 1 ? 'has' : 'have'} no prices in the snapshot`, snapshot, timeZone);
  }

  const L = facts.latest;
  const today = viewerDate(now, timeZone);
  const from = freshFrom(today);
  const fresh = L >= from;
  const latestDates = new Set(Object.values(facts.fundLatest));
  const disagree = latestDates.size > 1;
  const partial = disagree || facts.droppedIn2m.length > 0;
  const states: BadgeState[] = [fresh ? 'FRESH' : 'STALE', ...(partial ? (['PARTIAL'] as const) : [])];

  const weekend = weekday(today) === 0 || weekday(today) === 6;
  const counted = weekend ? `, a ${WEEKDAYS[weekday(today)]} that counts as the Monday after` : '';
  const details = [
    ...snapshotLines(snapshot, timeZone),
    fresh
      ? `FRESH: the latest NAV is of ${L}; on ${today}${counted}, a NAV from ${from} on is fresh (two weekdays back).`
      : `STALE: the latest NAV is of ${L}, older than ${from}, two weekdays before ${today}${counted}. The snapshot was not rebuilt, or the source stopped publishing.`,
  ];
  if (disagree) {
    details.push(`PARTIAL: the funds' latest NAVs differ, so the portfolio's is held back to ${L} by the fund that lags.`);
    const newest = [...latestDates].sort().at(-1);
    for (const [id, date] of Object.entries(facts.fundLatest)) details.push(`${names[id] ?? id}: ${date}${date === newest ? '' : ' (behind)'}`);
  }
  if (facts.droppedIn2m.length > 0) {
    const dates = facts.droppedIn2m.join(', ');
    details.push(
      `PARTIAL: ${dates} ${facts.droppedIn2m.length === 1 ? 'is' : 'are'} missing for some funds, so the portfolio's line and returns skip ${facts.droppedIn2m.length === 1 ? 'it' : 'them'}.`,
    );
  }
  details.push(...runLines(snapshot));
  // A run that failed writes back the previous file, whose L can still be FRESH: the badge says so itself.
  const run = snapshot.state === 'partial' || snapshot.state === 'failed' ? snapshot.state : undefined;

  return {
    state: 'loaded',
    states,
    tone: fresh && !partial && !run ? 'ok' : 'warn',
    text: `NAV as of ${L} · snapshot ${utcTime(snapshot.generatedAt)} · ${states.join(' · ')}${run ? ` · run ${run}` : ''}`,
    run,
    details,
    anchorDate,
    latest: L,
    source: snapshot.source?.name || DEFAULT_SOURCE,
    generatedAt: snapshot.generatedAt,
  };
}

/** Whether the performance sections (tiles, chart, return columns) have numbers to show. */
export function hasPrices(f: Freshness): boolean {
  return f.state === 'loaded';
}
