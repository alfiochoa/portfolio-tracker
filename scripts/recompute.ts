// What the page should show, from the two data files: the verifier's oracle.
//
//   node scripts/recompute.ts [path/to/prices.json] [--now <ISO instant>] [--total <euros> [--total-as-of <date>]]
//
// Reads data/portfolio.json, data/funds.json and the snapshot (public/data/prices.json unless a
// path is given) and prints L, each window's start S and portfolio return, then each fund's five
// returns, formatted exactly as the page formats them. It calls the same functions as the page
// (src/lib/returns.ts, ARCHITECTURE rule 4), so the two cannot disagree. V(S) and V(L) are printed
// unrounded for a hand check. After the chart, the freshness badge's text and detail lines, judged
// by src/lib/freshness.ts at `--now` (the real clock when absent) in this machine's time zone; the
// instant and zone used are printed so the check can be repeated. Exit code 1 when the snapshot is
// missing or unreadable (the badge, ERROR or no prices yet, is still printed).
//
// With --total, the euro amounts the page shows for that total typed on --total-as-of (the
// snapshot's L when absent), from src/lib/euros.ts as the page computes them: the worth line, each
// tile's change, each fund's value and five changes, the total row, rounded as the page rounds them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatIndex, portfolioIndex } from '../src/lib/chart.ts';
import { computeEuros, parseEuros, type Euros } from '../src/lib/euros.ts';
import { formatEuros, formatPercent, formatSignedPercent } from '../src/lib/format.ts';
import { assessFreshness, seriesFacts, type PricesOutcome } from '../src/lib/freshness.ts';
import { positionsOf, totalWeight, type Fund, type Portfolio } from '../src/lib/portfolio.ts';
import { readPrices, WINDOWS, type Returns, type WindowReturn } from '../src/lib/returns.ts';
import { parseSnapshot } from '../src/lib/snapshot.ts';

const NOT_ENOUGH = 'not enough history'; // as src/ui/tiles.ts shows it

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = <T>(file: string): T => JSON.parse(readFileSync(path.join(root, file), 'utf8')) as T;

/** Columns padded to their widest cell; the first left-aligned, the rest right-aligned. */
function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => [...(r[c] ?? '')].length)));
  return rows
    .map((r) => r.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join('  ').trimEnd())
    .join('\n');
}

const cell = (w: WindowReturn, value: (w: Extract<WindowReturn, { enough: true }>) => number | undefined): string => {
  if (!w.enough) return NOT_ENOUGH;
  const v = value(w);
  return v === undefined ? '—' : formatSignedPercent(v);
};

/** The chart's end label: the value index over the 2m window, 100 at its first point (src/ui/chart.ts draws it). */
function chartLine(returns: Returns): string {
  const points = portfolioIndex(returns);
  const last = points.at(-1);
  if (!last || points.length < 2) return 'Chart:    not enough history to draw a line';
  return `Chart:    100 on ${points[0]!.date} to ${formatIndex(last.value)} on ${last.date} (${points.length} points)`;
}

/** The badge as the page would show it at `now` in `timeZone`: its text, then its detail lines indented. */
export function badgeLines(portfolio: Portfolio, funds: readonly Fund[], prices: PricesOutcome, now: Date, timeZone: string): string[] {
  const names = Object.fromEntries(positionsOf(funds, portfolio).map((p) => [p.fund.id, p.fund.shortName]));
  const f = assessFreshness({ anchorDate: portfolio.anchorDate, prices, now, timeZone, names });
  const indent = ' '.repeat('Badge:    '.length);
  return [`Badge:    ${f.text}`, ...f.details.map((d) => indent + d), `${indent}(judged at ${now.toISOString()} in ${timeZone})`];
}

export function report(portfolio: Portfolio, funds: readonly Fund[], returns: Returns, header: string, badge: readonly string[] = []): string {
  const positions = positionsOf(funds, portfolio);
  const last = returns.values.length - 1;
  const lines = [
    header,
    `Anchor T: ${returns.anchor}`,
    `Latest L: ${returns.latest}   V(L) = ${returns.values[last]}`,
    `Series:   ${returns.dates.length} dates, ${returns.dates[0]} to ${returns.latest}; dropped: ${returns.dropped.join(', ') || 'none'}`,
    chartLine(returns),
    ...badge,
    '',
    table([
      ['Window', 'Start S', 'V(S)', 'Portfolio'],
      ...returns.windows.map((w) =>
        w.enough
          ? [w.window, w.start, String(returns.values[returns.dates.indexOf(w.start)]), formatSignedPercent(w.portfolio)]
          : [w.window, '—', '—', NOT_ENOUGH],
      ),
    ]),
    '',
    table([
      ['Fund', 'Weight', ...WINDOWS],
      ...positions.map((p) => [
        `${p.fund.shortName} (${p.fund.id})`,
        formatPercent(p.weight),
        ...returns.windows.map((w) => cell(w, (x) => x.funds[p.fund.id])),
      ]),
      ['Total', formatPercent(totalWeight(positions)), ...returns.windows.map((w) => cell(w, (x) => x.portfolio))],
    ]),
  ];
  return lines.join('\n');
}

/** The euro amounts for `euros`, as the page shows them (the line under the tiles, the tiles, the table). */
export function euroReport(portfolio: Portfolio, funds: readonly Fund[], returns: Returns, amounts: Euros): string {
  const typed = formatEuros(amounts.entered.euros, 'value');
  if (amounts.kind === 'not-in-series') {
    return [
      `Euros:    ${typed} entered for ${amounts.entered.asOf}, which is not a date of the portfolio series (${amounts.older ? 'older than it' : 'dropped, or after L'}):`,
      '          no amounts are shown anywhere, and the line asks for the total again.',
    ].join('\n');
  }
  const positions = positionsOf(funds, portfolio);
  const from = amounts.entered.asOf === amounts.latest ? 'the amount you entered' : `from the ${typed} you entered for ${amounts.entered.asOf}; assumes nothing added or withdrawn since`;
  const change = (i: number, fund: string | null): string => {
    const w = amounts.windows[i]!;
    if (!w.enough) return NOT_ENOUGH;
    const v = fund === null ? w.portfolio : w.funds[fund];
    return v === undefined ? '—' : formatEuros(v, 'change');
  };
  return [
    `Euros:    Worth ${formatEuros(amounts.worth, 'value')} on ${amounts.latest}, ${from}.   E = ${amounts.worth}`,
    '',
    table([
      ['Window', 'Portfolio', 'Change'],
      ...returns.windows.map((w, i) => [w.window, cell(w, (x) => x.portfolio), change(i, null)]),
    ]),
    '',
    table([
      ['Fund', 'Value', ...WINDOWS],
      ...positions.map((p) => [
        `${p.fund.shortName} (${p.fund.id})`,
        formatEuros(amounts.funds[p.fund.id]!, 'value'),
        ...WINDOWS.map((_, i) => change(i, p.fund.id)),
      ]),
      ['Total', formatEuros(amounts.worth, 'value'), ...WINDOWS.map((_, i) => change(i, null))],
    ]),
  ].join('\n');
}

/** Take `--name value` out of `args`; undefined when absent. */
function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
}

function main(): number {
  const args = process.argv.slice(2);
  const totalArg = option(args, '--total');
  const totalAsOf = option(args, '--total-as-of');
  const total = totalArg === undefined ? undefined : parseEuros(totalArg);
  if (total === null || (total === undefined && totalAsOf !== undefined)) {
    console.error(`recompute: --total wants a positive whole number of euros, such as 25000, not ${totalArg ?? 'nothing'}`);
    return 1;
  }
  if (totalAsOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(totalAsOf)) {
    console.error(`recompute: --total-as-of wants a date such as 2026-11-03, not ${totalAsOf}`);
    return 1;
  }
  const at = args.indexOf('--now');
  const nowArg = at >= 0 ? args.splice(at, 2)[1] : undefined;
  const now = nowArg === undefined ? new Date() : new Date(nowArg);
  if (Number.isNaN(now.getTime())) {
    console.error(`recompute: --now wants an ISO instant such as 2026-11-06T11:00:00Z, not ${nowArg ?? 'nothing'}`);
    return 1;
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const snapshotPath = args[0] ?? path.join('public', 'data', 'prices.json');
  const portfolio = readJson<Portfolio>(path.join('data', 'portfolio.json'));
  const funds = readJson<Fund[]>(path.join('data', 'funds.json'));
  const badge = (prices: PricesOutcome): string[] => badgeLines(portfolio, funds, prices, now, timeZone);
  let text: string;
  try {
    text = readFileSync(path.resolve(root, snapshotPath), 'utf8');
  } catch (e) {
    console.error(`recompute: no snapshot at ${snapshotPath} (${(e as Error).message})`);
    console.log(badge({ kind: 'missing' }).join('\n'));
    return 1;
  }
  try {
    const { snapshot, returns } = readPrices(portfolio, text);
    const header = `Snapshot: ${snapshotPath}, generated ${snapshot.generatedAt}, ${snapshot.source?.name}, state ${snapshot.state}`;
    const facts = seriesFacts(returns, portfolio.positions.map((p) => p.fund), snapshot.funds);
    console.log(report(portfolio, funds, returns, header, badge({ kind: 'loaded', snapshot, facts })));
    if (total !== undefined) {
      const amounts = computeEuros(portfolio, snapshot.funds, returns, { euros: total, asOf: totalAsOf ?? returns.latest });
      console.log(`\n${euroReport(portfolio, funds, returns, amounts)}`);
    }
    return 0;
  } catch (e) {
    const reason = (e as Error).message;
    console.error(`recompute: the snapshot ${snapshotPath} is unreadable: ${reason}`);
    let snapshot;
    try {
      snapshot = parseSnapshot(text);
    } catch {
      snapshot = undefined;
    }
    console.log(badge({ kind: 'unreadable', reason, snapshot }).join('\n'));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
