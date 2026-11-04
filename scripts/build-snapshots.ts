// sources -> public/data/prices.json, the snapshot the page reads.
//
//   npm run snapshots
//
// For every fund in data/funds.json, one request to Yahoo Finance's chart endpoint, one after the
// other with a short pause; each response is parsed (src/lib/yahoo.ts) and checked
// (src/lib/snapshot.ts). It fails closed: a fund that cannot be refreshed keeps its previous bars
// (state `partial`); when no fund can, the previous file is written back with `state: "failed"`;
// with no previous file to fall back on, nothing is written. Exit code 1 when nothing was
// refreshed or nothing written. The npm script loads .env (Node's --env-file-if-exists) for sources that need a key;
// Yahoo needs none.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fund } from '../src/lib/portfolio.ts';
import {
  mergeRun,
  parseSnapshot,
  renderSnapshot,
  validateBars,
  type FundResult,
  type Outcome,
  type Snapshot,
} from '../src/lib/snapshot.ts';
import { parseChart, SourceError } from '../src/lib/yahoo.ts';

export const chartUrl = (symbol: string): string =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;

// The bare browser token. Checked 2026-11-04: Yahoo answered 429 to full Chrome and Firefox
// User-Agent strings from this machine, every time, and 200 to this one, every time.
export const USER_AGENT = 'Mozilla/5.0';

export interface RunOptions {
  /** Each request's timeout. */
  timeoutMs?: number;
  /** The pause between two funds' requests. */
  pauseMs?: number;
  /** The wait before the one retry of a request that got no usable answer (429, 5xx, network). */
  retryMs?: number;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One GET, as JSON. Throws a SourceError naming the status or the network failure. */
async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = e as Error;
    const code = (err.cause as { code?: unknown } | undefined)?.code; // undici's "fetch failed" hides it here
    const why = err.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : `${err.message}${typeof code === 'string' ? ` (${code})` : ''}`;
    throw new SourceError(`network: ${why}`, { cause: e });
  }
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const said = text.trim().slice(0, 60);
    throw new SourceError(`HTTP ${response.status}${response.status === 200 ? ' but not JSON' : ''}${said ? ` (${said})` : ''}`);
  }
  if (response.status !== 200) {
    // A 404 for an unknown symbol comes with a chart error saying so: keep the source's words.
    let said = '';
    try {
      parseChart(json);
    } catch (e) {
      said = `: ${(e as Error).message}`;
    }
    throw new SourceError(`HTTP ${response.status}${said}`);
  }
  return json;
}

const retryable = (e: SourceError) => /^network:|^HTTP (429|5\d\d)/.test(e.message);

/** Fetch, parse and check one fund. Never throws: a failure is a result with its reason. */
export async function fetchFund(fund: Fund, opts: Required<Omit<RunOptions, 'log'>>): Promise<FundResult> {
  const symbol = fund.sources.yahoo;
  if (!symbol) return { id: fund.id, ok: false, reason: 'no Yahoo symbol in data/funds.json' };
  try {
    let json: unknown;
    try {
      json = await getJson(chartUrl(symbol), opts.timeoutMs);
    } catch (e) {
      if (!(e instanceof SourceError) || !retryable(e)) throw e;
      await sleep(opts.retryMs);
      json = await getJson(chartUrl(symbol), opts.timeoutMs);
    }
    const series = parseChart(json);
    validateBars(series.bars);
    return { id: fund.id, ok: true, currency: series.currency, bars: series.bars };
  } catch (e) {
    return { id: fund.id, ok: false, reason: (e as Error).message };
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
  for (const [i, fund] of funds.entries()) {
    if (i > 0) await sleep(opts.pauseMs);
    const r = await fetchFund(fund, opts);
    results.push(r);
    const symbol = (fund.sources.yahoo ?? '?').padEnd(13);
    if (r.ok) {
      log(`${fund.id.padEnd(9)} ${symbol} ${String(r.bars.length).padStart(4)} bars  ${r.bars[0]![0]} … ${r.bars.at(-1)![0]}`);
    } else {
      const kept = previous?.funds[fund.id] ? `kept ${previous.funds[fund.id]!.bars.length} previous bars` : 'nothing to keep';
      log(`${fund.id.padEnd(9)} ${symbol} FAILED: ${r.reason} (${kept})`);
    }
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
  console.log(`Wrote ${rel}: state ${snapshot.state}, ${Object.keys(snapshot.funds).length} funds, ${span}${snapshot.error ? `; ${snapshot.error}` : ''}.`);
  if (snapshot.state === 'failed') process.exitCode = 1;
}

if (import.meta.main) await main();
