import { describe, expect, it } from 'vitest';
import {
  assessFreshness,
  freshFrom,
  hasPrices,
  localTime,
  seriesFacts,
  viewerDate,
  type FreshnessInput,
  type SeriesFacts,
  type SnapshotMeta,
} from '../src/lib/freshness.ts';
import { computeReturns } from '../src/lib/returns.ts';

const ANCHOR = '2026-11-04';
const TZ = 'Europe/Madrid';
const SNAPSHOT: SnapshotMeta = { generatedAt: '2026-11-04T06:30:00Z', source: { name: 'Yahoo Finance (unofficial)', kind: 'yahoo' }, state: 'ok' };
/** Three funds, all at L = 2026-11-03 (a Tuesday), nothing dropped. */
const FACTS: SeriesFacts = { latest: '2026-11-03', fundLatest: { a: '2026-11-03', b: '2026-11-03', c: '2026-11-03' }, droppedIn2m: [] };

/** Noon in Madrid on `date`. */
const at = (date: string): Date => new Date(`${date}T11:00:00Z`);

function assess(over: Partial<FreshnessInput> = {}, facts: Partial<SeriesFacts> = {}, snapshot: Partial<SnapshotMeta> = {}) {
  return assessFreshness({
    anchorDate: ANCHOR,
    prices: { kind: 'loaded', snapshot: { ...SNAPSHOT, ...snapshot }, facts: { ...FACTS, ...facts } },
    now: at('2026-11-04'),
    timeZone: TZ,
    ...over,
  });
}

describe('two weekdays before today', () => {
  it('is the Thursday before from a Monday, the Monday from a Wednesday', () => {
    expect(freshFrom('2026-11-09')).toBe('2026-11-05'); // Monday
    expect(freshFrom('2026-11-11')).toBe('2026-11-09'); // Wednesday
    expect(freshFrom('2026-11-10')).toBe('2026-11-06'); // Tuesday: the Friday before
  });

  it('counts a Saturday and a Sunday as the Monday after', () => {
    expect(freshFrom('2026-11-07')).toBe('2026-11-05');
    expect(freshFrom('2026-11-08')).toBe('2026-11-05');
  });

  it("takes today's date in the viewer's own time zone", () => {
    const lateEvening = new Date('2026-11-04T23:30:00Z');
    expect(viewerDate(lateEvening, 'Europe/Madrid')).toBe('2026-11-05');
    expect(viewerDate(lateEvening, 'America/New_York')).toBe('2026-11-04');
  });
});

describe('FRESH and STALE', () => {
  it('is FRESH when L is no older than two weekdays before today', () => {
    expect(assess().states).toEqual(['FRESH']);
    expect(assess({ now: at('2026-11-05') }).states).toEqual(['FRESH']); // Thursday: from Tuesday on
  });

  it('is STALE when L is older than that', () => {
    const f = assess({ now: at('2026-11-06') }); // Friday: from Wednesday on
    expect(f.states).toEqual(['STALE']);
    expect(f.tone).toBe('warn');
    expect(f.details).toContain(
      'STALE: the latest NAV is of 2026-11-03, older than 2026-11-04, two weekdays before 2026-11-06. The snapshot was not rebuilt, or the source stopped publishing.',
    );
  });

  it('counts weekdays, not calendar days: on a Monday the Thursday before is FRESH, the Wednesday is not', () => {
    const monday = at('2026-11-09');
    expect(assess({ now: monday }, { latest: '2026-11-05', fundLatest: { a: '2026-11-05' } }).states).toEqual(['FRESH']);
    expect(assess({ now: monday }, { latest: '2026-11-04', fundLatest: { a: '2026-11-04' } }).states).toEqual(['STALE']);
  });

  it("is FRESH on a Saturday with Thursday's NAV, and says why", () => {
    const f = assess({ now: at('2026-11-07') }, { latest: '2026-11-05', fundLatest: { a: '2026-11-05' } });
    expect(f.states).toEqual(['FRESH']);
    expect(f.details).toContain(
      'FRESH: the latest NAV is of 2026-11-05; on 2026-11-07, a Saturday that counts as the Monday after, a NAV from 2026-11-05 on is fresh (two weekdays back).',
    );
  });

  it('judges the date in the viewer’s zone: just after midnight in Madrid it is already the next day', () => {
    // 2026-11-05 23:30 UTC is Friday 00:30 in Madrid (from Wednesday on) but Thursday evening in New York.
    const now = new Date('2026-11-05T23:30:00Z');
    expect(assess({ now, timeZone: 'Europe/Madrid' }).states).toEqual(['STALE']);
    expect(assess({ now, timeZone: 'America/New_York' }).states).toEqual(['FRESH']);
  });

  it('writes the badge as NAV as of L · snapshot <UTC time> · STATE, in the ok colour', () => {
    const f = assess();
    expect(f.text).toBe('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
    expect(f.tone).toBe('ok');
    expect(f.state).toBe('loaded');
    expect(hasPrices(f)).toBe(true);
  });

  it('names the source and the snapshot time in UTC and in the viewer’s time', () => {
    expect(assess().details.slice(0, 2)).toEqual([
      'Source: Yahoo Finance (unofficial)',
      'Snapshot built 2026-11-04 06:30 UTC (2026-11-04 07:30 CET your time)',
    ]);
    expect(localTime('2026-11-04T06:30:00Z', 'America/New_York')).toBe('2026-11-04 01:30 GMT-5');
  });
});

describe('PARTIAL', () => {
  it('is added when the funds disagree on their latest date, with each fund’s date in the detail', () => {
    const f = assess(
      { names: { a: 'US 500', b: 'Japan' } },
      { latest: '2026-11-02', fundLatest: { a: '2026-11-03', b: '2026-11-02', c: '2026-11-03' } },
    );
    expect(f.states).toEqual(['FRESH', 'PARTIAL']);
    expect(f.text).toBe('NAV as of 2026-11-02 · snapshot 2026-11-04 06:30 UTC · FRESH · PARTIAL');
    expect(f.tone).toBe('warn');
    expect(f.details).toEqual(expect.arrayContaining(['US 500: 2026-11-03', 'Japan: 2026-11-02 (behind)', 'c: 2026-11-03']));
  });

  it('is added when a date was dropped in the 2m window, naming it', () => {
    const f = assess({ now: at('2026-11-10') }, { droppedIn2m: ['2026-10-26'] });
    expect(f.states).toEqual(['STALE', 'PARTIAL']);
    expect(f.details).toContain("PARTIAL: 2026-10-26 is missing for some funds, so the portfolio's line and returns skip it.");
  });

  it('takes the dropped dates from the 2m window only, and each fund’s latest from its own bars', () => {
    const portfolio = { anchorDate: '2026-11-04', sourceFile: 'x.xlsx', positions: [{ fund: 'a', weight: 0.5 }, { fund: 'b', weight: 0.5 }] };
    const bars = (dates: string[]): [string, number][] => dates.map((d) => [d, 100]);
    const funds = {
      // b lacks 2026-08-14 (before the 2m window, which starts 2026-09-03) and 2026-10-26 (inside it); a lacks L's successor.
      a: { bars: bars(['2026-08-13', '2026-08-14', '2026-09-03', '2026-10-26', '2026-11-03']) },
      b: { bars: bars(['2026-08-13', '2026-09-03', '2026-11-03', '2026-11-04']) },
    };
    const facts = seriesFacts(computeReturns(portfolio, funds), ['a', 'b'], funds);
    expect(facts).toEqual({ latest: '2026-11-03', fundLatest: { a: '2026-11-03', b: '2026-11-04' }, droppedIn2m: ['2026-10-26'] });
  });
});

describe('ERROR', () => {
  it('is the state when the snapshot cannot be loaded or parsed, with the reason', () => {
    const f = assessFreshness({ anchorDate: ANCHOR, prices: { kind: 'unreadable', reason: 'the snapshot answered HTTP 500' }, now: at('2026-11-04'), timeZone: TZ });
    expect(f.states).toEqual(['ERROR']);
    expect(f.tone).toBe('error');
    expect(f.state).toBe('unreadable');
    expect(hasPrices(f)).toBe(false);
    expect(f.text).toBe('Allocation as of 2026-11-04 · prices unreadable · ERROR');
    expect(f.details[0]).toBe('ERROR: the snapshot answered HTTP 500');
  });

  it('keeps the snapshot’s source and time when it parsed but the returns could not be computed', () => {
    const f = assessFreshness({
      anchorDate: ANCHOR,
      prices: { kind: 'unreadable', reason: 'fund japan has no bars', snapshot: SNAPSHOT },
      now: at('2026-11-04'),
      timeZone: TZ,
    });
    expect(f.details.slice(0, 3)).toEqual([
      'ERROR: fund japan has no bars',
      'Source: Yahoo Finance (unofficial)',
      'Snapshot built 2026-11-04 06:30 UTC (2026-11-04 07:30 CET your time)',
    ]);
  });

  it('is the state when a fund has no bars, naming it', () => {
    const f = assess({ names: { b: 'Japan' } }, { fundLatest: { a: '2026-11-03', b: null } });
    expect(f.states).toEqual(['ERROR']);
    expect(f.details[0]).toBe('ERROR: Japan has no prices in the snapshot');
    expect(hasPrices(f)).toBe(false);
  });
});

describe('the snapshot run’s own state', () => {
  it('is in the detail when partial, with the recorded error', () => {
    const f = assess({}, {}, { state: 'partial', error: '1 of 8 funds kept from the previous snapshot: japan: HTTP 429' });
    expect(f.details.at(-1)).toBe('The snapshot run was partial: 1 of 8 funds kept from the previous snapshot: japan: HTTP 429');
  });

  it('is in the detail when failed, with the recorded error', () => {
    const f = assess({ now: at('2026-11-06') }, {}, { state: 'failed', error: 'every fund failed: …' });
    expect(f.states).toEqual(['STALE']);
    expect(f.details.at(-1)).toBe('The last snapshot run failed, so these are the previous prices: every fund failed: …');
  });

  it('adds nothing when ok', () => {
    expect(assess().details.some((d) => d.startsWith('The snapshot run') || d.startsWith('The last snapshot'))).toBe(false);
  });
});

describe('before there are prices', () => {
  it('says it is loading, in no state colour, with no numbers', () => {
    const f = assessFreshness({ anchorDate: ANCHOR, prices: { kind: 'loading' }, now: at('2026-11-04') });
    expect(f.text).toBe('Allocation as of 2026-11-04 · loading prices…');
    expect(f.tone).toBe('none');
    expect(f.states).toEqual([]);
    expect(hasPrices(f)).toBe(false);
  });

  it('says no prices yet when there is no snapshot', () => {
    const f = assessFreshness({ anchorDate: ANCHOR, prices: { kind: 'missing' }, now: at('2026-11-04') });
    expect(f.text).toBe('Allocation as of 2026-11-04 · no prices yet');
    expect(f.state).toBe('no-snapshot');
    expect(hasPrices(f)).toBe(false);
  });
});
