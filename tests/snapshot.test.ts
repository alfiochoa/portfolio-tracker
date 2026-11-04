// The snapshot: the checks on a fund's bars, the merge with the previous file (fail closed, keep
// what we had), its text, and the whole run with `fetch` replaced by a stub (tests/setup.ts makes
// the real one throw).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chartUrl, run, USER_AGENT } from '../scripts/build-snapshots.ts';
import type { Fund } from '../src/lib/portfolio.ts';
import {
  MAX_GAP_DAYS,
  MIN_BARS,
  mergeRun,
  parseSnapshot,
  renderSnapshot,
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
    expect(s).toMatchObject({ generatedAt: '2026-11-04T21:40:00Z', source: { name: 'Yahoo Finance (unofficial)', kind: 'yahoo' }, state: 'ok' });
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

describe('renderSnapshot', () => {
  const s = snapshotOf(mergeRun(null, [ok('a', weekdays(61)), ok('b', weekdays(61))], NOW));

  it('is JSON that reads back to the same snapshot', () => {
    expect(parseSnapshot(renderSnapshot(s))).toEqual(s);
    const partial = snapshotOf(mergeRun(s, [ok('a'), fail('b', 'HTTP "429"')], LATER));
    expect(parseSnapshot(renderSnapshot(partial))).toEqual(partial);
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

/** Replace fetch: `answer(symbol, attempt)` gives the response (or a network error) for each request. */
function stubFetch(answer: (symbol: string, attempt: number) => Answer): void {
  const attempts = new Map<string, number>();
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: init?.headers as Record<string, string>, signal: init?.signal instanceof AbortSignal });
    const symbol = decodeURIComponent(/chart\/([^?]+)/.exec(url)![1]!);
    const n = (attempts.get(symbol) ?? 0) + 1;
    attempts.set(symbol, n);
    const a = answer(symbol, n);
    if (a instanceof Error) throw a;
    return a;
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const barsFor = (symbol: string) => weekdays(125, '2026-11-03', 100 + symbol.charCodeAt(9));
const healthy = (symbol: string) => json(chartJson(symbol, barsFor(symbol)));
const quiet = { pauseMs: 0, retryMs: 0, log: () => {} };

describe('run, with fetch stubbed', () => {
  beforeEach(() => {
    requests = [];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('asks Yahoo once per fund, in order, with a browser-like User-Agent and a timeout', async () => {
    stubFetch(healthy);
    const lines: string[] = [];
    const outcome = await run(funds, null, () => NOW, { ...quiet, log: (l) => lines.push(l) });
    expect(requests.map((r) => r.url)).toEqual(funds.map((f) => chartUrl(f.sources.yahoo!)));
    expect(requests[0]!.url).toBe('https://query1.finance.yahoo.com/v8/finance/chart/0P00011HBK.F?range=6mo&interval=1d');
    expect(requests.every((r) => r.headers['User-Agent'] === USER_AGENT && r.signal)).toBe(true);
    expect(USER_AGENT).toMatch(/^Mozilla\/5\.0/);
    const s = snapshotOf(outcome);
    expect(s.state).toBe('ok');
    expect(Object.keys(s.funds)).toEqual(['us500', 'europe', 'emerging']);
    expect(s.funds.us500!.bars).toEqual(barsFor('0P00011HBK.F'));
    expect(lines).toEqual([
      'us500     0P00011HBK.F   125 bars  2026-05-13 … 2026-11-03',
      'europe    0P00011HBL.F   125 bars  2026-05-13 … 2026-11-03',
      'emerging  0P00011HBQ.F   125 bars  2026-05-13 … 2026-11-03',
    ]);
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
    expect(lines[1]).toBe('europe    0P00011HBL.F  FAILED: HTTP 429 (Too Many Requests) (kept 125 previous bars)');
  });

  it('retries once after a 429 and uses the second answer', async () => {
    stubFetch((symbol, attempt) => (attempt === 1 ? new Response('Too Many Requests', { status: 429 }) : healthy(symbol)));
    const s = snapshotOf(await run(funds, null, () => NOW, quiet));
    expect(s.state).toBe('ok');
    expect(requests).toHaveLength(6);
  });

  it('does not retry a refusal that will not change (404, a parse or validation failure)', async () => {
    stubFetch(healthy);
    const previous = snapshotOf(await run(funds, null, () => NOW, quiet));
    requests = [];
    const notFound = JSON.parse(readFileSync(new URL('./fixtures/yahoo/not-found.json', import.meta.url), 'utf8'));
    stubFetch((symbol) => {
      if (symbol === '0P00011HBK.F') return json(notFound, 404);
      if (symbol === '0P00011HBL.F') return json(chartJson(symbol, weekdays(40)));
      return json({ ...(chartJson(symbol, barsFor(symbol)) as object), chart: { result: [{ meta: { ...meta, currency: 'USD' } }], error: null } });
    });
    const s = snapshotOf(await run(funds, previous, () => LATER, quiet));
    expect(requests).toHaveLength(3);
    expect(s.state).toBe('failed');
    expect(s.error).toBe(
      'every fund failed: us500: HTTP 404: the source reported an error: Not Found: No data found, symbol may be delisted; ' +
        'europe: only 40 bars, at least 60 needed; emerging: the currency is "USD", not EUR',
    );
  });

  it('every fund fails: the previous file comes back with state failed, bars untouched', async () => {
    stubFetch(healthy);
    const previous = snapshotOf(await run(funds, null, () => NOW, quiet));
    stubFetch(() => new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) }));
    const s = snapshotOf(await run(funds, previous, () => LATER, quiet));
    expect(s).toEqual({ ...previous, generatedAt: '2026-11-04T21:45:00Z', state: 'failed', error: expect.stringMatching(/^every fund failed: us500: network: fetch failed \(ECONNREFUSED\);/) });
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
