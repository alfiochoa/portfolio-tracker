// The snapshot: the checks on a fund's bars, the merge with the previous file (fail closed, keep
// what we had), its text, and the whole run with `fetch` replaced by a stub (tests/setup.ts makes
// the real one throw).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chartUrl, run, USER_AGENT } from '../scripts/build-snapshots.ts';
import { productUrl } from '../src/lib/vanguard.ts';
import { vanguardPage } from './fixtures/vanguard/page.ts';
import type { Fund } from '../src/lib/portfolio.ts';
import {
  carryForward,
  differences,
  MAX_GAP_DAYS,
  MIN_BARS,
  mergeRun,
  overlayBars,
  parseSnapshot,
  renderSnapshot,
  SOURCE,
  validateBars,
  type FundResult,
  type Snapshot,
} from '../src/lib/snapshot.ts';
import type { Bar } from '../src/lib/yahoo.ts';

/** `n` weekday bars ending on `last`, NAVs from `start` up by 0.25 a day. */
function weekdays(n: number, last = '2026-11-03', start = 100): Bar[] {
  const dates: string[] = [];
  for (let t = Date.parse(`${last}T00:00:00Z`); dates.length < n; t -= 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(d.toISOString().slice(0, 10));
  }
  return dates.map((d, i) => [d, start + i * 0.25]);
}

const NOW = new Date('2026-11-04T21:40:00.123Z');
const LATER = new Date('2026-11-04T21:45:00Z');

describe('validateBars', () => {
  it('accepts three months of weekdays and reports the latest date', () => {
    expect(validateBars(weekdays(65))).toEqual({ latest: '2026-11-03' });
    expect(validateBars(weekdays(MIN_BARS))).toEqual({ latest: '2026-11-03' });
  });

  it(`refuses fewer than ${MIN_BARS} bars`, () => {
    expect(() => validateBars(weekdays(MIN_BARS - 1))).toThrow(`only 59 bars, at least 60 needed`);
    expect(() => validateBars([])).toThrow('only 0 bars');
  });

  it(`refuses a gap of more than ${MAX_GAP_DAYS} calendar days, and accepts one of ${MAX_GAP_DAYS}`, () => {
    const bars = weekdays(70);
    const week = bars.filter(([d]) => d < '2026-10-23' || d > '2026-10-29'); // Thu 22 -> Fri 30: 8 days
    expect(() => validateBars(week)).toThrow('a gap of 8 days between 2026-10-22 and 2026-10-30 (at most 7)');
    const seven = bars.filter(([d]) => d < '2026-10-23' || d > '2026-10-28'); // Thu 22 -> Thu 29: 7 days
    expect(() => validateBars(seven)).not.toThrow();
  });

  it('refuses bars out of order or on the same date', () => {
    const bars = weekdays(65);
    const swapped = [...bars];
    [swapped[10], swapped[11]] = [swapped[11]!, swapped[10]!];
    expect(() => validateBars(swapped)).toThrow(/not strictly ascending/);
    expect(() => validateBars([...bars, bars.at(-1)!])).toThrow(/not strictly ascending/);
  });
});

const ok = (id: string, bars = weekdays(65)): FundResult => ({ id, ok: true, currency: 'EUR', bars });
const fail = (id: string, reason = 'HTTP 429'): FundResult => ({ id, ok: false, reason });
const snapshotOf = (outcome: ReturnType<typeof mergeRun>): Snapshot => {
  if (!outcome.write) throw new Error(`expected a snapshot, got: ${outcome.error}`);
  return outcome.snapshot;
};

describe('mergeRun', () => {
  const first = () => snapshotOf(mergeRun(null, [ok('a'), ok('b', weekdays(65, '2026-11-03', 50))], NOW));

  it('writes every fund, state ok, times in UTC without milliseconds', () => {
    const s = first();
    expect(s).toMatchObject({
      generatedAt: '2026-11-04T21:40:00Z',
      source: { name: 'Vanguard (official) + Yahoo Finance (unofficial)', kind: 'vanguard+yahoo' },
      state: 'ok',
    });
    expect(s.error).toBeUndefined();
    expect(Object.keys(s.funds)).toEqual(['a', 'b']);
    expect(s.funds.a).toEqual({ currency: 'EUR', fetchedAt: '2026-11-04T21:40:00Z', bars: weekdays(65) });
  });

  it('keeps a fund’s previous entry, fetchedAt included, when its bars have not changed', () => {
    const second = snapshotOf(mergeRun(first(), [ok('a'), ok('b', weekdays(66, '2026-11-04', 50))], LATER));
    expect(second.funds.a!.fetchedAt).toBe('2026-11-04T21:40:00Z');
    expect(second.funds.b!.fetchedAt).toBe('2026-11-04T21:45:00Z');
    expect(second.funds.b!.bars.at(-1)![0]).toBe('2026-11-04');
  });

  it('one fund fails: its previous bars are kept with the reason, state partial', () => {
    const s = snapshotOf(mergeRun(first(), [ok('a', weekdays(66, '2026-11-04')), fail('b', 'HTTP 429')], LATER));
    expect(s.state).toBe('partial');
    expect(s.error).toBe('1 of 2 funds kept from the previous snapshot: b: HTTP 429');
    expect(s.funds.b).toEqual({ ...first().funds.b, kept: true, error: 'HTTP 429' });
    expect(s.funds.a!.bars).toHaveLength(66);
  });

  it('every fund fails: the previous file comes back unchanged but for generatedAt, state and error', () => {
    const previous = first();
    const s = snapshotOf(mergeRun(previous, [fail('a', 'HTTP 403'), fail('b', 'network: no answer within 15 s')], LATER));
    expect(s).toEqual({
      ...previous,
      generatedAt: '2026-11-04T21:45:00Z',
      state: 'failed',
      error: 'every fund failed: a: HTTP 403; b: network: no answer within 15 s',
    });
  });

  it('a fund fails and there is no previous file: nothing to write', () => {
    const outcome = mergeRun(null, [ok('a'), fail('b')], NOW);
    expect(outcome).toEqual({ write: false, error: 'no previous snapshot to keep, and b failed (b: HTTP 429)' });
  });

  it('a fund fails and the previous file does not have it: nothing to write', () => {
    const outcome = mergeRun(first(), [ok('a'), ok('b'), fail('c')], LATER);
    expect(outcome).toEqual({ write: false, error: 'no previous bars to keep for c (c: HTTP 429)' });
  });

  it('a fund that was kept and now fetches again loses kept and error', () => {
    const partial = snapshotOf(mergeRun(first(), [ok('a'), fail('b')], LATER));
    const again = snapshotOf(mergeRun(partial, [ok('a'), ok('b', partial.funds.b!.bars)], LATER));
    expect(again.state).toBe('ok');
    expect(again.error).toBeUndefined();
    expect(again.funds.b).toEqual({ currency: 'EUR', fetchedAt: '2026-11-04T21:45:00Z', bars: partial.funds.b!.bars });
  });
});

// --- the merge with Vanguard's bars --------------------------------------------------------------

/** Yahoo's bars as the real ones were: the weekdays to 2026-11-03 without 2026-10-26. */
const yahooBars = (n = 66, last = '2026-11-03') => weekdays(n, last).filter(([d]) => d !== '2026-10-26');
/** Vanguard's ten: the last ten weekdays to `last`, at the same values as weekdays(66) unless changed. */
const vanguardBars = (last = '2026-11-03', change: Record<string, number> = {}): Bar[] =>
  weekdays(66, last).slice(-10).map(([d, v]) => [d, change[d] ?? v]);
const withV = (r: FundResult, v: Bar[] | string): FundResult => ({ ...r, vanguard: typeof v === 'string' ? { ok: false, reason: v } : { ok: true, bars: v } });

describe('mergeRun with Vanguard', () => {
  const first = () => snapshotOf(mergeRun(null, [withV(ok('a', yahooBars()), vanguardBars()), withV(ok('b', yahooBars()), vanguardBars())], NOW));

  it('lays Vanguard over Yahoo: its value wins on a shared date, the entry says which dates', () => {
    const s = snapshotOf(mergeRun(null, [withV(ok('a', weekdays(66)), vanguardBars('2026-11-03', { '2026-10-27': 111.9205 }))], NOW));
    const nav = new Map(s.funds.a!.bars);
    expect(nav.get('2026-10-27')).toBe(111.9205);
    expect(s.funds.a!.bars).toHaveLength(66);
    expect(s.funds.a!.vanguard).toEqual({ fetchedAt: '2026-11-04T21:40:00Z', from: '2026-10-21', to: '2026-11-03', bars: 10 });
    expect(s).toMatchObject({ state: 'ok', source: SOURCE });
    expect(s.warning).toBeUndefined();
  });

  it('fills a date Yahoo lacks, in order', () => {
    const s = snapshotOf(mergeRun(null, [withV(ok('a', yahooBars()), vanguardBars())], NOW));
    const dates = s.funds.a!.bars.map(([d]) => d);
    expect(dates.slice(-8)).toEqual(['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03']);
    expect(s.funds.a!.bars).toEqual(weekdays(66));
  });

  it('appends a date Vanguard has after Yahoo’s last', () => {
    const s = snapshotOf(mergeRun(null, [withV(ok('a', yahooBars(65, '2026-11-02')), vanguardBars('2026-11-03'))], NOW));
    expect(s.funds.a!.bars.at(-1)).toEqual(['2026-11-03', weekdays(66).at(-1)![1]]);
    expect(s.funds.a!.bars.at(-2)![0]).toBe('2026-11-02');
  });

  it('Yahoo failed, Vanguard ok: the previous bars are kept and Vanguard laid over them, state partial', () => {
    const previous = snapshotOf(mergeRun(null, [ok('a', yahooBars()), ok('b', yahooBars())], NOW));
    expect(previous.funds.b!.bars.some(([d]) => d === '2026-10-26')).toBe(false);
    const s = snapshotOf(mergeRun(previous, [withV(ok('a', yahooBars()), vanguardBars()), withV(fail('b', 'HTTP 429'), vanguardBars())], LATER));
    expect(s.state).toBe('partial');
    expect(s.error).toBe('1 of 2 funds kept from the previous snapshot: b: HTTP 429');
    expect(s.funds.b).toEqual({
      currency: 'EUR',
      fetchedAt: '2026-11-04T21:40:00Z',
      kept: true,
      error: 'HTTP 429',
      vanguard: { fetchedAt: '2026-11-04T21:45:00Z', from: '2026-10-21', to: '2026-11-03', bars: 10 },
      bars: weekdays(66),
    });
  });

  it('Yahoo ok, Vanguard failed: state ok, Yahoo’s bars alone, and a warning naming the fund', () => {
    const s = snapshotOf(mergeRun(null, [withV(ok('a', yahooBars()), vanguardBars()), withV(ok('b', yahooBars()), 'HTTP 404 (404 | Vanguard UK Professional)')], NOW));
    expect(s.state).toBe('ok');
    expect(s.error).toBeUndefined();
    expect(s.warning).toBe("Vanguard failed for 1 of 2 funds, so Yahoo's bars alone are used for them: b: HTTP 404 (404 | Vanguard UK Professional)");
    expect(s.funds.b).toEqual({ currency: 'EUR', fetchedAt: '2026-11-04T21:40:00Z', vanguard: { error: 'HTTP 404 (404 | Vanguard UK Professional)' }, bars: yahooBars() });
  });

  it('both failed for one fund: it keeps its previous bars, state partial', () => {
    const previous = first();
    const s = snapshotOf(mergeRun(previous, [withV(ok('a', yahooBars()), vanguardBars()), withV(fail('b', 'HTTP 429'), 'network: fetch failed')], LATER));
    expect(s.state).toBe('partial');
    expect(s.warning).toBeUndefined();
    expect(s.funds.b).toEqual({ ...previous.funds.b, kept: true, error: 'HTTP 429', vanguard: { error: 'network: fetch failed' } });
  });

  it('Yahoo failed for every fund but Vanguard answered for one: partial, not failed', () => {
    const s = snapshotOf(mergeRun(first(), [withV(fail('a'), vanguardBars('2026-11-04')), withV(fail('b'), 'HTTP 500')], LATER));
    expect(s.state).toBe('partial');
    expect(s.funds.a!.bars.at(-1)![0]).toBe('2026-11-04');
  });

  it('both failed for every fund: the previous file comes back, state failed, without its old warning', () => {
    const previous = snapshotOf(mergeRun(null, [withV(ok('a', yahooBars()), vanguardBars()), withV(ok('b', yahooBars()), 'HTTP 500')], NOW));
    expect(previous.warning).toBeDefined();
    const s = snapshotOf(mergeRun(previous, [withV(fail('a', 'HTTP 403'), 'HTTP 500'), withV(fail('b', 'HTTP 403'), 'network: fetch failed')], LATER));
    const { warning: _gone, ...rest } = previous; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(s).toEqual({
      ...rest,
      generatedAt: '2026-11-04T21:45:00Z',
      state: 'failed',
      error: 'every fund failed: a: HTTP 403 (vanguard: HTTP 500); b: HTTP 403 (vanguard: network: fetch failed)',
    });
  });

  it('a second run with the same answers changes only generatedAt', () => {
    const one = first();
    const two = snapshotOf(mergeRun(parseSnapshot(renderSnapshot(one)), [withV(ok('a', yahooBars()), vanguardBars()), withV(ok('b', yahooBars()), vanguardBars())], LATER));
    expect(diffLines(renderSnapshot(one), renderSnapshot(two))).toEqual([
      '-   "generatedAt": "2026-11-04T21:40:00Z",',
      '+   "generatedAt": "2026-11-04T21:45:00Z",',
    ]);
  });

  it('a new day from Vanguard: its fetchedAt and the fund’s move on', () => {
    const next = vanguardBars('2026-11-04');
    const s = snapshotOf(mergeRun(first(), [withV(ok('a', yahooBars()), next), withV(ok('b', yahooBars()), vanguardBars())], LATER));
    expect(s.funds.a!.vanguard).toEqual({ fetchedAt: '2026-11-04T21:45:00Z', from: '2026-10-22', to: '2026-11-04', bars: 10 });
    expect(s.funds.a!.fetchedAt).toBe('2026-11-04T21:45:00Z');
    expect(s.funds.b!.vanguard).toEqual(first().funds.b!.vanguard);
  });

  it('a date Vanguard filled stays after Vanguard’s window moves past it; a second such run changes only generatedAt', () => {
    const previous = first(); // 2026-10-26 from Vanguard, the ten to 2026-11-03
    const filled = new Map(previous.funds.a!.bars).get('2026-10-26')!;
    // A week later: Yahoo still lacks 2026-10-26, and Vanguard's ten are 2026-10-28 … 2026-11-10.
    const yahoo = yahooBars(66, '2026-11-10');
    const answers = [withV(ok('a', yahoo), vanguardBars('2026-11-10')), withV(ok('b', yahoo), vanguardBars('2026-11-10'))];
    const s = snapshotOf(mergeRun(previous, answers, LATER));
    expect(s.funds.a!.vanguard).toMatchObject({ from: '2026-10-28', to: '2026-11-10' });
    const nav = new Map(s.funds.a!.bars);
    expect(nav.get('2026-10-26')).toBe(filled); // carried from the previous file
    expect(nav.get('2026-10-23')).toBe(new Map(yahoo).get('2026-10-23')); // Yahoo wins where it has a value
    expect(nav.get('2026-10-23')).not.toBe(new Map(previous.funds.a!.bars).get('2026-10-23'));
    expect(s.funds.a!.bars.map(([d]) => d)).toEqual(weekdays(66, '2026-11-10').map(([d]) => d).filter((d) => d >= yahoo[0]![0]));
    const again = snapshotOf(mergeRun(parseSnapshot(renderSnapshot(s)), answers, new Date('2026-11-04T21:50:00Z')));
    expect(diffLines(renderSnapshot(s), renderSnapshot(again))).toEqual([
      '-   "generatedAt": "2026-11-04T21:45:00Z",',
      '+   "generatedAt": "2026-11-04T21:50:00Z",',
    ]);
  });

  it('Vanguard bars that would leave a gap in the kept history are not laid over, and say why', () => {
    const previous = snapshotOf(mergeRun(null, [ok('a', weekdays(66, '2026-10-01'))], NOW));
    const s = snapshotOf(mergeRun(previous, [withV(fail('a'), vanguardBars())], LATER));
    expect(s.funds.a!.bars).toEqual(previous.funds.a!.bars);
    expect(s.funds.a!.vanguard).toEqual({ error: 'not laid over: a gap of 20 days between 2026-10-01 and 2026-10-21 (at most 7)' });
  });
});

describe('overlayBars, carryForward and differences', () => {
  it('carryForward: the previous bar on a date inside the fresh span that the fresh bars lack, nothing outside it', () => {
    const fresh: Bar[] = [['2026-10-22', 2], ['2026-10-23', 3], ['2026-10-27', 5]];
    const previous: Bar[] = [['2026-10-21', 1], ['2026-10-23', 30], ['2026-10-26', 4], ['2026-10-28', 6]];
    expect(carryForward(fresh, previous)).toEqual([['2026-10-22', 2], ['2026-10-23', 3], ['2026-10-26', 4], ['2026-10-27', 5]]);
    expect(carryForward(fresh, [])).toEqual(fresh);
    expect(carryForward([], previous)).toEqual([]);
  });

  it('overlayBars: the second wins on a shared date, the rest merged in date order', () => {
    expect(overlayBars([['2026-10-23', 1], ['2026-10-27', 2]], [['2026-10-26', 9], ['2026-10-27', 8], ['2026-10-28', 7]])).toEqual([
      ['2026-10-23', 1],
      ['2026-10-26', 9],
      ['2026-10-27', 8],
      ['2026-10-28', 7],
    ]);
  });

  it(`differences: shared dates that differ by more than 0.00005, not those within it`, () => {
    const y: Bar[] = [['2026-10-26', 1], ['2026-10-27', 611.92], ['2026-10-28', 613.89575]];
    const v: Bar[] = [['2026-10-27', 611.9205], ['2026-10-28', 613.8957], ['2026-10-29', 610]];
    expect(differences(y, v)).toEqual([{ date: '2026-10-27', yahoo: 611.92, vanguard: 611.9205 }]);
  });
});

describe('renderSnapshot', () => {
  const s = snapshotOf(mergeRun(null, [ok('a', weekdays(61)), ok('b', weekdays(61))], NOW));

  it('is JSON that reads back to the same snapshot', () => {
    expect(parseSnapshot(renderSnapshot(s))).toEqual(s);
    const partial = snapshotOf(mergeRun(s, [ok('a'), fail('b', 'HTTP "429"')], LATER));
    expect(parseSnapshot(renderSnapshot(partial))).toEqual(partial);
    const warned = snapshotOf(mergeRun(s, [withV(ok('a'), weekdays(10)), withV(ok('b'), 'HTTP "404"')], LATER));
    expect(warned.warning).toBeDefined();
    expect(parseSnapshot(renderSnapshot(warned))).toEqual(warned);
  });

  it('puts the warning after the state and the Vanguard entry on one line before the bars', () => {
    const warned = snapshotOf(mergeRun(null, [withV(ok('a', weekdays(61)), weekdays(10)), withV(ok('b', weekdays(61)), 'HTTP 404')], NOW));
    const text = renderSnapshot(warned);
    expect(text).toContain(`  "state": "ok",\n  "warning": ${JSON.stringify(warned.warning)},\n  "funds": {`);
    expect(text).toContain(
      '      "vanguard": {"fetchedAt":"2026-11-04T21:40:00Z","from":"2026-10-21","to":"2026-11-03","bars":10},\n      "bars": [',
    );
    expect(text).toContain('      "vanguard": {"error":"HTTP 404"},\n      "bars": [');
  });

  it('puts one bar per line, so a daily refresh is a short diff', () => {
    const text = renderSnapshot(s);
    expect(text).toContain('\n        ["2026-11-03",115]\n      ]');
    expect(text.split('\n').filter((l) => /^ {8}\["\d{4}-\d{2}-\d{2}",[\d.]+\],?$/.test(l))).toHaveLength(122);
    // The next day: the range drops its first bar and gains one at the end.
    const rolled: Bar[] = [...s.funds.a!.bars.slice(1), ['2026-11-04', 115.5]];
    const next = snapshotOf(mergeRun(s, [ok('a', rolled), ok('b', weekdays(61))], LATER));
    expect(diffLines(text, renderSnapshot(next))).toEqual([
      '-   "generatedAt": "2026-11-04T21:40:00Z",',
      '+   "generatedAt": "2026-11-04T21:45:00Z",',
      '-       "fetchedAt": "2026-11-04T21:40:00Z",',
      '+       "fetchedAt": "2026-11-04T21:45:00Z",',
      `-         ${JSON.stringify(s.funds.a!.bars[0])},`,
      '-         ["2026-11-03",115]',
      '+         ["2026-11-03",115],',
      '+         ["2026-11-04",115.5]',
    ]);
  });
});

describe('parseSnapshot', () => {
  const good = snapshotOf(mergeRun(null, [ok('a', weekdays(61))], NOW));
  /** The good snapshot's text with its top-level fields changed (`undefined` removes one). */
  const withFields = (fields: Record<string, unknown>): string => JSON.stringify({ ...good, ...fields });
  const committed = (...p: string[]): string => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', ...p), 'utf8');

  it('reads the committed snapshot and both e2e fixtures', () => {
    for (const file of [['public', 'data', 'prices.json'], ['e2e', 'fixtures', 'prices.json'], ['e2e', 'fixtures', 'prices-lagging.json']]) {
      expect(() => parseSnapshot(committed(...file)), file.join('/')).not.toThrow();
    }
  });

  it('accepts an ISO time with milliseconds or an offset', () => {
    expect(parseSnapshot(withFields({ generatedAt: '2026-11-04T21:40:00.123Z' })).generatedAt).toBe('2026-11-04T21:40:00.123Z');
    expect(parseSnapshot(withFields({ generatedAt: '2026-11-04T22:40:00+01:00' })).generatedAt).toBe('2026-11-04T22:40:00+01:00');
    expect(parseSnapshot(withFields({ generatedAt: '2028-02-29T00:00:00Z' })).generatedAt).toBe('2028-02-29T00:00:00Z'); // a leap year
  });

  it('refuses a generatedAt that is not an ISO time', () => {
    for (const generatedAt of [
      'yesterday',
      '2026-11-04',
      '2026-13-45T25:00:00Z',
      'Wed, 04 Nov 2026 21:40:00 GMT',
      '',
      // Dates the calendar does not have, which Date.parse would roll into the next month.
      '2026-02-30T00:00:00Z',
      '2026-04-31T00:00:00Z',
      '2027-02-29T00:00:00Z',
      '2026-00-10T00:00:00Z',
      '2026-11-00T00:00:00Z',
    ]) {
      expect(() => parseSnapshot(withFields({ generatedAt })), generatedAt).toThrow(
        `the snapshot's generatedAt is not an ISO time: ${JSON.stringify(generatedAt)}`,
      );
    }
    expect(() => parseSnapshot(withFields({ generatedAt: 1762292400000 }))).toThrow('not a snapshot (no generatedAt or funds)');
  });

  it('refuses a state other than ok, partial or failed', () => {
    expect(() => parseSnapshot(withFields({ state: 'weird' }))).toThrow(`the snapshot's state is not ok, partial or failed: "weird"`);
    expect(() => parseSnapshot(withFields({ state: 'OK' }))).toThrow(`the snapshot's state is not ok, partial or failed: "OK"`);
    expect(() => parseSnapshot(withFields({ state: undefined }))).toThrow(`the snapshot's state is not ok, partial or failed: null`);
    for (const state of ['ok', 'partial', 'failed']) expect(parseSnapshot(withFields({ state })).state).toBe(state);
  });

  it('accepts the Vanguard fields as optional, and refuses them when they are nonsense', () => {
    expect(parseSnapshot(withFields({ warning: 'Vanguard failed for 1 of 8 funds' })).warning).toBe('Vanguard failed for 1 of 8 funds');
    expect(() => parseSnapshot(withFields({ warning: 42 }))).toThrow("the snapshot's warning is not text");
    const fund = (vanguard: unknown) => withFields({ funds: { a: { ...good.funds.a, vanguard } } });
    expect(parseSnapshot(fund({ error: 'HTTP 404' })).funds.a!.vanguard).toEqual({ error: 'HTTP 404' });
    expect(() => parseSnapshot(fund('yes'))).toThrow("fund a's vanguard entry is not an object");
    expect(() => parseSnapshot(fund(null))).toThrow("fund a's vanguard entry is not an object");
  });

  it('refuses a snapshot without a source or whose source has no name', () => {
    for (const source of [undefined, null, 'Yahoo', { kind: 'yahoo' }, { name: 42, kind: 'yahoo' }]) {
      expect(() => parseSnapshot(withFields({ source })), JSON.stringify(source)).toThrow('the snapshot does not name its source');
    }
  });
});

/** A line diff of two texts (longest common subsequence): removed lines as `- x`, added as `+ x`. */
function diffLines(a: string, b: string): string[] {
  const la = a.split('\n');
  const lb = b.split('\n');
  const lcs = la.map(() => new Array<number>(lb.length + 1).fill(0));
  lcs.push(new Array<number>(lb.length + 1).fill(0));
  for (let i = la.length - 1; i >= 0; i--)
    for (let j = lb.length - 1; j >= 0; j--)
      lcs[i]![j] = la[i] === lb[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < la.length || j < lb.length) {
    if (i < la.length && j < lb.length && la[i] === lb[j]) {
      i++;
      j++;
    }
    else if (i < la.length && (j === lb.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push(`- ${la[i++]}`);
    else out.push(`+ ${lb[j++]}`);
  }
  return out;
}

// --- the whole run, fetch stubbed ---------------------------------------------------------------

const catalogue = JSON.parse(readFileSync(new URL('../data/funds.json', import.meta.url), 'utf8')) as Fund[];
const funds = catalogue.slice(0, 3);
const meta = JSON.parse(readFileSync(new URL('./fixtures/yahoo/us500-0P00011HBK.F.json', import.meta.url), 'utf8')).chart.result[0]
  .meta as Record<string, unknown>;

/** A chart response in Yahoo's real shape: bars at 07:00 UTC, then the current day's all-null bar. */
function chartJson(symbol: string, bars: readonly Bar[]): unknown {
  const timestamp = [...bars.map(([d]) => Date.parse(`${d}T07:00:00Z`) / 1000), Date.parse('2026-11-04T07:00:00Z') / 1000];
  const close = [...bars.map(([, v]) => v), null];
  return {
    chart: {
      result: [{ meta: { ...meta, symbol }, timestamp, indicators: { quote: [{ open: close, high: close, low: close, close, volume: close.map((c) => (c === null ? null : 0)) }], adjclose: [{ adjclose: close }] } }],
      error: null,
    },
  };
}

type Answer = Response | Error;
let requests: { url: string; headers: Record<string, string>; signal: boolean }[] = [];
const realFetch = globalThis.fetch;

/**
 * Replace fetch: Yahoo's chart requests are answered by `yahoo(symbol, attempt)`, Vanguard's
 * product pages by `vanguard(id, attempt)` (healthy unless given), each a response or a network error.
 */
function stubFetch(yahoo: (symbol: string, attempt: number) => Answer, vanguard: (id: string, attempt: number) => Answer = vanguardHealthy): void {
  const attempts = new Map<string, number>();
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: init?.headers as Record<string, string>, signal: init?.signal instanceof AbortSignal });
    const chart = /chart\/([^?]+)/.exec(url);
    const page = /\/product\/fund\/(?:equity|bond)\/(\d+)\//.exec(url);
    const n = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, n);
    const a = chart ? yahoo(decodeURIComponent(chart[1]!), n) : page ? vanguard(page[1]!, n) : new Error(`unexpected request: ${url}`);
    if (a instanceof Error) throw a;
    return a;
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const barsFor = (symbol: string) => weekdays(125, '2026-11-03', 100 + symbol.charCodeAt(9));
const healthy = (symbol: string) => json(chartJson(symbol, barsFor(symbol)));
const fundByPage = (id: string) => catalogue.find((f) => f.sources.vanguard?.id === id)!;
/** The fund's page, listing its last ten bars at Yahoo's values (changed where `change` says). */
const pageFor = (id: string, change: Record<string, number> = {}) => {
  const fund = fundByPage(id);
  return html(vanguardPage(fund.isin, barsFor(fund.sources.yahoo!).slice(-10).map(([d, v]): Bar => [d, change[d] ?? v])));
};
const vanguardHealthy = (id: string) => pageFor(id);
const vanguardNotFound = readFileSync(new URL('./fixtures/vanguard/not-found.html', import.meta.url), 'utf8');
const refusedConnection = () => new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) });
const quiet = { pauseMs: 0, retryMs: 0, log: () => {} };
const isYahoo = (r: { url: string }) => r.url.includes('/v8/finance/chart/');

describe('run, with fetch stubbed', () => {
  beforeEach(() => {
    requests = [];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('asks Yahoo then Vanguard once per fund, in order, with a browser-like User-Agent and a timeout', async () => {
    stubFetch(healthy);
    const lines: string[] = [];
    const outcome = await run(funds, null, () => NOW, { ...quiet, log: (l) => lines.push(l) });
    expect(requests.map((r) => r.url)).toEqual(
      funds.flatMap((f) => [chartUrl(f.sources.yahoo!), productUrl(f.sources.vanguard!.kind, f.sources.vanguard!.id, f.isin)]),
    );
    expect(requests[0]!.url).toBe('https://query1.finance.yahoo.com/v8/finance/chart/0P00011HBK.F?range=6mo&interval=1d');
    expect(requests[1]!.url).toBe('https://www.vanguard.co.uk/professional/product/fund/equity/9186/IE00BFPM9V94');
    expect(requests.every((r) => r.headers['User-Agent'] === USER_AGENT && r.signal)).toBe(true);
    expect(USER_AGENT).toMatch(/^Mozilla\/5\.0/);
    const s = snapshotOf(outcome);
    expect(s.state).toBe('ok');
    expect(Object.keys(s.funds)).toEqual(['us500', 'europe', 'emerging']);
    expect(s.funds.us500!.bars).toEqual(barsFor('0P00011HBK.F'));
    expect(s.funds.us500!.vanguard).toEqual({ fetchedAt: '2026-11-04T21:40:00Z', from: '2026-10-21', to: '2026-11-03', bars: 10 });
    expect(lines).toEqual([
      'us500     0P00011HBK.F   125 bars  2026-05-13 … 2026-11-03',
      'us500     vanguard        10 bars  2026-10-21 … 2026-11-03',
      'europe    0P00011HBL.F   125 bars  2026-05-13 … 2026-11-03',
      'europe    vanguard        10 bars  2026-10-21 … 2026-11-03',
      'emerging  0P00011HBQ.F   125 bars  2026-05-13 … 2026-11-03',
      'emerging  vanguard        10 bars  2026-10-21 … 2026-11-03',
    ]);
  });

  it('prints each shared date where the two differ (more than 0.00005), and keeps Vanguard’s value', async () => {
    const us500 = barsFor('0P00011HBK.F');
    const [d1, y1] = us500.at(-5)!;
    stubFetch(healthy, (id) => (id === '9186' ? pageFor(id, { [d1]: y1 + 0.0005 }) : vanguardHealthy(id)));
    const lines: string[] = [];
    const s = snapshotOf(await run(funds, null, () => NOW, { ...quiet, log: (l) => lines.push(l) }));
    expect(lines.filter((l) => l.includes(': yahoo '))).toEqual([`us500 ${d1}: yahoo ${y1} vanguard ${y1 + 0.0005}, vanguard kept`]);
    expect(new Map(s.funds.us500!.bars).get(d1)).toBe(y1 + 0.0005);
    expect(s.state).toBe('ok');
  });

  it('a Vanguard page for another ISIN, or a 404, fails that fund’s Vanguard only: state ok with a warning', async () => {
    stubFetch(healthy, (id) => (id === '9186' ? pageFor('9177') : id === '9177' ? html(vanguardNotFound, 404) : vanguardHealthy(id)));
    const lines: string[] = [];
    const s = snapshotOf(await run(funds, null, () => NOW, { ...quiet, log: (l) => lines.push(l) }));
    expect(s.state).toBe('ok');
    expect(lines[1]).toBe('us500     vanguard      FAILED: the page is for IE00BFPM9L96, not IE00BFPM9V94');
    expect(lines[3]).toBe('europe    vanguard      FAILED: HTTP 404 (404 | Vanguard UK Professional)');
    expect(s.warning).toBe(
      "Vanguard failed for 2 of 3 funds, so Yahoo's bars alone are used for them: us500: the page is for IE00BFPM9L96, not IE00BFPM9V94; " +
        'europe: HTTP 404 (404 | Vanguard UK Professional)',
    );
    expect(requests.filter((r) => r.url.includes('/9177/'))).toHaveLength(1); // a 404 is not retried
  });

  it('run twice on the same answers, the second file differs from the first only in generatedAt', async () => {
    stubFetch(healthy);
    const one = snapshotOf(await run(funds, null, () => NOW, quiet));
    const two = snapshotOf(await run(funds, parseSnapshot(renderSnapshot(one)), () => LATER, quiet));
    const changed = diffLines(renderSnapshot(one), renderSnapshot(two));
    expect(changed).toEqual(['-   "generatedAt": "2026-11-04T21:40:00Z",', '+   "generatedAt": "2026-11-04T21:45:00Z",']);
  });

  it('one fund fails (HTTP 429 twice): it keeps its previous bars, state partial', async () => {
    stubFetch(healthy);
    const previous = snapshotOf(await run(funds, null, () => NOW, quiet));
    stubFetch((symbol) => (symbol === '0P00011HBL.F' ? new Response('Too Many Requests', { status: 429 }) : healthy(symbol)));
    const lines: string[] = [];
    const s = snapshotOf(await run(funds, previous, () => LATER, { ...quiet, log: (l) => lines.push(l) }));
    expect(s.state).toBe('partial');
    expect(s.funds.europe).toEqual({ ...previous.funds.europe, kept: true, error: 'HTTP 429 (Too Many Requests)' });
    expect(requests.filter((r) => r.url.includes('0P00011HBL.F'))).toHaveLength(1 + 2); // the first run, then one retry
    expect(lines[2]).toBe('europe    0P00011HBL.F  FAILED: HTTP 429 (Too Many Requests) (kept 125 previous bars)');
    expect(lines[3]).toBe('europe    vanguard        10 bars  2026-10-21 … 2026-11-03');
  });

  it('retries once after a 429 (either source) and uses the second answer', async () => {
    const tooMany = () => new Response('Too Many Requests', { status: 429 });
    stubFetch(
      (symbol, attempt) => (attempt === 1 ? tooMany() : healthy(symbol)),
      (id, attempt) => (attempt === 1 ? tooMany() : vanguardHealthy(id)),
    );
    const s = snapshotOf(await run(funds, null, () => NOW, quiet));
    expect(s.state).toBe('ok');
    expect(s.warning).toBeUndefined();
    expect(requests).toHaveLength(12);
  });

  it('gives Vanguard one retry on a network error or 5xx, then records the failure', async () => {
    stubFetch(healthy, (id) => (id === '9186' ? refusedConnection() : html('<html><title>Bad gateway</title></html>', 502)));
    const s = snapshotOf(await run(funds, null, () => NOW, quiet));
    expect(requests.filter((r) => !isYahoo(r))).toHaveLength(6);
    expect(s.funds.us500!.vanguard).toEqual({ error: 'network: fetch failed (ECONNREFUSED)' });
    expect(s.funds.europe!.vanguard).toEqual({ error: 'HTTP 502 (Bad gateway)' });
  });

  it('does not retry a refusal that will not change (404, a parse or validation failure)', async () => {
    stubFetch(healthy);
    const previous = snapshotOf(await run(funds, null, () => NOW, quiet));
    requests = [];
    const notFound = JSON.parse(readFileSync(new URL('./fixtures/yahoo/not-found.json', import.meta.url), 'utf8'));
    stubFetch(
      (symbol) => {
        if (symbol === '0P00011HBK.F') return json(notFound, 404);
        if (symbol === '0P00011HBL.F') return json(chartJson(symbol, weekdays(40)));
        return json({ ...(chartJson(symbol, barsFor(symbol)) as object), chart: { result: [{ meta: { ...meta, currency: 'USD' } }], error: null } });
      },
      (id) => (id === '9186' ? html(vanguardNotFound, 404) : id === '9177' ? pageFor('9175') : html('<html>no prices here</html>')),
    );
    const s = snapshotOf(await run(funds, previous, () => LATER, quiet));
    expect(requests).toHaveLength(6);
    expect(s.state).toBe('failed');
    expect(s.error).toBe(
      'every fund failed: us500: HTTP 404: the source reported an error: Not Found: No data found, symbol may be delisted ' +
        '(vanguard: HTTP 404 (404 | Vanguard UK Professional)); ' +
        'europe: only 40 bars, at least 60 needed (vanguard: the page is for IE00BFPM9J74, not IE00BFPM9L96); ' +
        'emerging: the currency is "USD", not EUR (vanguard: the page has no serverApp-state (not a product page))',
    );
  });

  it('every fund fails: the previous file comes back with state failed, bars untouched', async () => {
    stubFetch(healthy);
    const previous = snapshotOf(await run(funds, null, () => NOW, quiet));
    stubFetch(refusedConnection, refusedConnection);
    const s = snapshotOf(await run(funds, previous, () => LATER, quiet));
    expect(s).toEqual({
      ...previous,
      generatedAt: '2026-11-04T21:45:00Z',
      state: 'failed',
      error: expect.stringMatching(/^every fund failed: us500: network: fetch failed \(ECONNREFUSED\) \(vanguard: network: fetch failed \(ECONNREFUSED\)\);/),
    });
  });

  it('non-JSON and HTML answers are failures with the status in the reason', async () => {
    stubFetch((symbol) => (symbol === '0P00011HBK.F' ? new Response('<html>blocked</html>', { status: 200 }) : new Response('<html>no</html>', { status: 403 })));
    const outcome = await run(funds, null, () => NOW, quiet);
    expect(outcome).toEqual({
      write: false,
      error: expect.stringContaining('us500: HTTP 200 but not JSON (<html>blocked</html>); europe: HTTP 403 (<html>no</html>)'),
    });
  });

  it('a timeout is a failure saying so', async () => {
    stubFetch(() => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    const outcome = await run(funds.slice(0, 1), null, () => NOW, quiet);
    expect(outcome).toEqual({ write: false, error: 'no previous snapshot to keep, and us500 failed (us500: network: no answer within 15 s)' });
  });

  it('no previous file and one fund fails: nothing to write', async () => {
    stubFetch((symbol) => (symbol === '0P00011HBQ.F' ? new Response('', { status: 500 }) : healthy(symbol)));
    const outcome = await run(funds, null, () => NOW, quiet);
    expect(outcome).toEqual({ write: false, error: 'no previous snapshot to keep, and emerging failed (emerging: HTTP 500)' });
  });
});

// --- `npm run snapshots` as a process (verifier, T-003) -------------------------------------------
// The real script in a scratch copy of the repo, Yahoo and Vanguard answered by tests/fixtures/stub-sources-fetch.mjs:
// what Alfredo (or a scheduled job) sees is the exit code, the printed lines and the file on disk.

describe('npm run snapshots, as a process', () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const stub = path.join(repo, 'tests', 'fixtures', 'stub-sources-fetch.mjs');
  let dir = '';
  const file = () => path.join(dir, 'public', 'data', 'prices.json');
  const text = () => readFileSync(file(), 'utf8');

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'snapshots-'));
    for (const d of ['scripts', 'src', 'data']) cpSync(path.join(repo, d), path.join(dir, d), { recursive: true });
    cpSync(path.join(repo, 'package.json'), path.join(dir, 'package.json'));
    mkdirSync(path.join(dir, 'public', 'data'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const snapshots = (yahoo: string, vanguard = 'healthy') =>
    spawnSync('node', ['--import', stub, 'scripts/build-snapshots.ts'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, STUB_YAHOO: yahoo, STUB_VANGUARD: vanguard },
    });

  it('first run: one line per fund per source, a summary, exit 0, an ok file with every fund and 2026-10-26 filled', () => {
    const r = snapshots('healthy');
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(2 * catalogue.length + 1);
    expect(lines[0]).toMatch(/^us500 +0P00011HBK\.F +131 bars +2026-05-04 … 2026-11-03$/);
    expect(lines[1]).toBe('us500     vanguard        10 bars  2026-10-21 … 2026-11-03');
    expect(lines.at(-1)).toBe(`Wrote public/data/prices.json: state ok, ${catalogue.length} funds, latest NAV 2026-11-03.`);
    const s = parseSnapshot(text());
    expect(s).toMatchObject({ state: 'ok', source: { name: 'Vanguard (official) + Yahoo Finance (unofficial)', kind: 'vanguard+yahoo' } });
    expect(s.warning).toBeUndefined();
    expect(Object.keys(s.funds)).toEqual(catalogue.map((f) => f.id));
    for (const f of Object.values(s.funds)) {
      expect(f.bars).toHaveLength(132);
      expect(f.bars.some(([d]) => d === '2026-10-26')).toBe(true); // Yahoo's hole, Vanguard's value
      expect(f.vanguard).toMatchObject({ from: '2026-10-21', to: '2026-11-03', bars: 10 });
    }
    expect(s.funds.us500!.bars.at(-1)![0]).toBe('2026-11-03'); // the trailing all-null bar is not a NAV
  });

  it('a second run changes only the generatedAt line', () => {
    snapshots('healthy');
    const one = text();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100); // timestamps have one-second resolution
    expect(snapshots('healthy').status).toBe(0);
    const changed = diffLines(one, text());
    expect(changed).toHaveLength(2);
    expect(changed.every((l) => /"generatedAt"/.test(l))).toBe(true);
  });

  it('one symbol unknown: exit 0, state partial, that fund keeps its bars and says why', () => {
    snapshots('healthy');
    const before = parseSnapshot(text());
    const r = snapshots('bad:0P00011HBL.F');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/europe +0P00011HBL\.F +FAILED: HTTP 404: .*Not Found.* \(kept \d+ previous bars\)/);
    const s = parseSnapshot(text());
    expect(s.state).toBe('partial');
    expect(s.funds.europe).toEqual({ ...before.funds.europe, kept: true, error: expect.stringContaining('HTTP 404') });
    expect(s.funds.us500).toEqual(before.funds.us500);
  });

  it('one Vanguard page missing: exit 0, state ok, a warning naming the fund, its Yahoo bars and 2026-10-26 carried', () => {
    snapshots('healthy');
    const before = parseSnapshot(text());
    const r = snapshots('healthy', 'bad:9177');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('europe    vanguard      FAILED: HTTP 404 (404 | Vanguard UK Professional)\n');
    const s = parseSnapshot(text());
    expect(s.state).toBe('ok');
    expect(s.warning).toBe("Vanguard failed for 1 of 8 funds, so Yahoo's bars alone are used for them: europe: HTTP 404 (404 | Vanguard UK Professional)");
    expect(r.stdout.trim().split('\n').at(-1)).toBe(`Wrote public/data/prices.json: state ok, 8 funds, latest NAV 2026-11-03; ${s.warning}.`);
    expect(s.funds.europe!.vanguard).toEqual({ error: 'HTTP 404 (404 | Vanguard UK Professional)' });
    // Yahoo's bars, and 2026-10-26 (which Yahoo lacks) carried from the previous file: the hole stays filled.
    expect(s.funds.europe!.bars).toHaveLength(132);
    expect(s.funds.europe!.bars).toEqual(before.funds.europe!.bars);
    expect(s.funds.us500).toEqual(before.funds.us500);
  });

  it('both sources down for every fund: exit 1, previous bars written back, state failed', () => {
    snapshots('healthy');
    const before = parseSnapshot(text());
    const r = snapshots('down', 'down');
    expect(r.status).toBe(1);
    const s = parseSnapshot(text());
    expect(s).toEqual({ ...before, generatedAt: expect.any(String), state: 'failed', error: expect.stringContaining('ECONNREFUSED') });
    expect(s.funds).toEqual(before.funds);
  });

  it('Yahoo down for every fund, Vanguard up: exit 0, state partial, every fund kept with Vanguard laid over', () => {
    snapshots('healthy');
    const before = parseSnapshot(text());
    const r = snapshots('down');
    expect(r.status).toBe(0);
    const s = parseSnapshot(text());
    expect(s.state).toBe('partial');
    expect(s.error).toMatch(/^8 of 8 funds kept from the previous snapshot: us500: network: fetch failed \(ECONNREFUSED\);/);
    expect(s.funds.us500).toEqual({ ...before.funds.us500, kept: true, error: 'network: fetch failed (ECONNREFUSED)' });
  });

  it('no previous file and the source down: exit 1 and no file is created', () => {
    const r = snapshots('down');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/snapshot failed: no previous snapshot to keep/);
    expect(r.stdout).toMatch(/was not written\./);
    expect(() => readFileSync(file())).toThrow(/ENOENT/);
  });
});
