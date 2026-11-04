// sources -> public/data/prices.json, the snapshot the page reads.
//
//   npm run snapshots
//
// For every fund in data/funds.json, two requests, one after the other with a short pause between
// any two: Yahoo Finance's chart endpoint (six months of daily NAVs, src/lib/yahoo.ts), then
// Vanguard's product page (the last ten official NAVs, src/lib/vanguard.ts), whose bars are laid
// over Yahoo's (src/lib/snapshot.ts: Vanguard's value wins on a shared date, fills a hole). It
// fails closed: a fund whose Yahoo history cannot be refreshed keeps its previous bars (state
// `partial`); a Vanguard failure alone is a `warning`; when no fund gets bars from either source,
// the previous file is written back with `state: "failed"`; with no previous file to fall back
// on, nothing is written. Exit code 1 when nothing was refreshed or nothing written. The npm
// script loads .env (Node's --env-file-if-exists) for sources that need a key; these two need none.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fund } from '../src/lib/portfolio.ts';
import {
  differences,
  mergeRun,
  parseSnapshot,
  renderSnapshot,
  validateBars,
  type FundResult,
  type Outcome,
  type Snapshot,
  type SourceResult,
} from '../src/lib/snapshot.ts';
import { parseProductPage, productUrl } from '../src/lib/vanguard.ts';
import { parseChart, SourceError, type Bar } from '../src/lib/yahoo.ts';

export const chartUrl = (symbol: string): string =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;

// The bare browser token. Checked 2026-11-04: Yahoo answered 429 to full Chrome and Firefox
// User-Agent strings from this machine, every time, and 200 to this one, every time. Vanguard
// answers 200 to it too (2026-11-05).
export const USER_AGENT = 'Mozilla/5.0';

export interface RunOptions {
  /** Each request's timeout. */
  timeoutMs?: number;
  /** The pause between any two requests (Yahoo then Vanguard for a fund, then the next fund). */
  pauseMs?: number;
  /** The wait before the one retry of a request that got no usable answer (429, 5xx, network). */
  retryMs?: number;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One GET: the status and the body's text. Throws a SourceError naming the network failure. */
async function get(url: string, accept: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, text: await response.text() };
  } catch (e) {
    const err = e as Error;
    const code = (err.cause as { code?: unknown } | undefined)?.code; // undici's "fetch failed" hides it here
    const why = err.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : `${err.message}${typeof code === 'string' ? ` (${code})` : ''}`;
    throw new SourceError(`network: ${why}`, { cause: e });
  }
}

/** One GET, as JSON. Throws a SourceError naming the status or the network failure. */
async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const { status, text } = await get(url, 'application/json', timeoutMs);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const said = text.trim().slice(0, 60);
    throw new SourceError(`HTTP ${status}${status === 200 ? ' but not JSON' : ''}${said ? ` (${said})` : ''}`);
  }
  if (status !== 200) {
    // A 404 for an unknown symbol comes with a chart error saying so: keep the source's words.
    let said = '';
    try {
      parseChart(json);
    } catch (e) {
      said = `: ${(e as Error).message}`;
    }
    throw new SourceError(`HTTP ${status}${said}`);
  }
  return json;
}

/** One GET of a web page. Throws a SourceError naming the status (and the page's title) or the network failure. */
async function getPage(url: string, timeoutMs: number): Promise<string> {
  const { status, text } = await get(url, 'text/html', timeoutMs);
  if (status !== 200) {
    const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
    const said = title || text.trim().slice(0, 60);
    throw new SourceError(`HTTP ${status}${said ? ` (${said})` : ''}`);
  }
  return text;
}

const retryable = (e: SourceError) => /^network:|^HTTP (429|5\d\d)/.test(e.message);

/** `attempt()`, and once more after a pause when it got no usable answer (429, 5xx, network). */
async function withRetry<T>(attempt: () => Promise<T>, retryMs: number): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    if (!(e instanceof SourceError) || !retryable(e)) throw e;
    await sleep(retryMs);
    return attempt();
  }
}

type Timing = Required<Omit<RunOptions, 'log'>>;

/** Fetch, parse and check one fund's Yahoo history. Never throws: a failure is a result with its reason. */
export async function fetchFund(fund: Fund, opts: Timing): Promise<FundResult> {
  const symbol = fund.sources.yahoo;
  if (!symbol) return { id: fund.id, ok: false, reason: 'no Yahoo symbol in data/funds.json' };
  try {
    const series = parseChart(await withRetry(() => getJson(chartUrl(symbol), opts.timeoutMs), opts.retryMs));
    validateBars(series.bars);
    return { id: fund.id, ok: true, currency: series.currency, bars: series.bars };
  } catch (e) {
    return { id: fund.id, ok: false, reason: (e as Error).message };
  }
}

/** Fetch and parse one fund's Vanguard product page. Never throws: a failure is a result with its reason. */
export async function fetchVanguard(fund: Fund, opts: Timing): Promise<SourceResult> {
  const page = fund.sources.vanguard;
  if (!page) return { ok: false, reason: 'no Vanguard page in data/funds.json' };
  try {
    const html = await withRetry(() => getPage(productUrl(page.kind, page.id, fund.isin), opts.timeoutMs), opts.retryMs);
    return { ok: true, bars: parseProductPage(html, fund.isin).bars };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** The whole run, without touching the disk: what to write, and the lines to print. */
export async function run(
  funds: readonly Fund[],
  previous: Snapshot | null,
  now: () => Date,
  options: RunOptions = {},
): Promise<Outcome> {
  const opts = { timeoutMs: 15_000, pauseMs: 1_500, retryMs: 2_000, ...options };
  const log = options.log ?? ((line: string) => console.log(line));
  const results: FundResult[] = [];
  const span = (bars: readonly Bar[]) => `${String(bars.length).padStart(4)} bars  ${bars[0]![0]} … ${bars.at(-1)![0]}`;
  let requests = 0;
  const pause = async () => {
    if (requests++ > 0) await sleep(opts.pauseMs);
  };
  for (const fund of funds) {
    await pause();
    const r: FundResult = await fetchFund(fund, opts);
    const symbol = (fund.sources.yahoo ?? '?').padEnd(13);
    if (r.ok) {
      log(`${fund.id.padEnd(9)} ${symbol} ${span(r.bars)}`);
    } else {
      const kept = previous?.funds[fund.id] ? `kept ${previous.funds[fund.id]!.bars.length} previous bars` : 'nothing to keep';
      log(`${fund.id.padEnd(9)} ${symbol} FAILED: ${r.reason} (${kept})`);
    }
    if (fund.sources.vanguard) {
      await pause();
      const v = await fetchVanguard(fund, opts);
      r.vanguard = v;
      log(`${fund.id.padEnd(9)} ${'vanguard'.padEnd(13)} ${v.ok ? span(v.bars) : `FAILED: ${v.reason}`}`);
      if (v.ok && r.ok) {
        for (const d of differences(r.bars, v.bars)) log(`${fund.id} ${d.date}: yahoo ${d.yahoo} vanguard ${d.vanguard}, vanguard kept`);
      }
    }
    results.push(r);
  }
  return mergeRun(previous, results, now());
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = path.join(root, 'public', 'data', 'prices.json');
  const rel = path.relative(root, out);
  const funds = JSON.parse(readFileSync(path.join(root, 'data', 'funds.json'), 'utf8')) as Fund[];

  let previous: Snapshot | null = null;
  if (existsSync(out)) {
    try {
      previous = parseSnapshot(readFileSync(out, 'utf8'));
    } catch (e) {
      console.log(`${rel} is unreadable (${(e as Error).message}); treating it as absent.`);
    }
  }

  const outcome = await run(funds, previous, () => new Date());
  if (!outcome.write) {
    console.log(`snapshot failed: ${outcome.error}\n${rel} was not written.`);
    process.exitCode = 1;
    return;
  }
  const { snapshot } = outcome;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(`${out}.tmp`, renderSnapshot(snapshot));
  renameSync(`${out}.tmp`, out);
  const latest = Object.values(snapshot.funds).map((f) => f.bars.at(-1)?.[0] ?? '-');
  const span = `latest NAV ${[...new Set(latest)].sort().join(' / ')}`;
  console.log(`Wrote ${rel}: state ${snapshot.state}, ${Object.keys(snapshot.funds).length} funds, ${span}${snapshot.error ? `; ${snapshot.error}` : ''}${snapshot.warning ? `; ${snapshot.warning}` : ''}.`);
  if (snapshot.state === 'failed') process.exitCode = 1;
}

if (import.meta.main) await main();
