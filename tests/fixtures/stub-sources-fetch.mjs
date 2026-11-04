// Preloaded (node --import) by the process tests of `npm run snapshots`: Yahoo and Vanguard are
// answered from here, never from the network, and the script's pauses and retry waits are skipped.
//   STUB_YAHOO=healthy          every chart request gets the weekdays 2026-05-04 .. 2026-11-03,
//                               without 2026-10-26 (as the real Yahoo), then the all-null bar
//   STUB_YAHOO=down             every Yahoo request fails like a closed port
//   STUB_YAHOO=bad:<symbol>     that symbol gets Yahoo's 404 body, the others are healthy
//   STUB_VANGUARD=healthy       every product page lists the ten weekdays 2026-10-21 .. 2026-11-03,
//                               2026-10-26 included, at the same values as Yahoo's
//   STUB_VANGUARD=down          every Vanguard request fails like a closed port
//   STUB_VANGUARD=bad:<id>      that page id gets Vanguard's real 404 page, the others are healthy
// The catalogue is read from data/funds.json in the working directory (the scratch repo).
import { readFileSync } from 'node:fs';
import { vanguardPage } from './vanguard/page.ts';

const yahooMode = process.env.STUB_YAHOO ?? 'healthy';
const vanguardMode = process.env.STUB_VANGUARD ?? 'healthy';
const catalogue = JSON.parse(readFileSync('data/funds.json', 'utf8'));
const notFound = readFileSync(new URL('./vanguard/not-found.html', import.meta.url), 'utf8');

const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);

/** Every weekday from 2026-05-04 to 2026-11-03 as [date, nav]; the NAV depends on the symbol and the day. */
function weekdays(symbol) {
  const base = 100 + symbol.charCodeAt(9);
  const out = [];
  for (let d = Date.parse('2026-05-04T00:00:00Z'), i = 0; d <= Date.parse('2026-11-03T00:00:00Z'); d += 86_400_000) {
    const day = new Date(d).getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push([new Date(d).toISOString().slice(0, 10), Math.round((base + i++ * 0.37) * 1e4) / 1e4]);
  }
  return out;
}

const refused = () => new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) });

function yahoo(symbol) {
  if (yahooMode === 'down') throw refused();
  if (yahooMode === `bad:${symbol}`) {
    const body = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };
    return new Response(JSON.stringify(body), { status: 404 });
  }
  const b = weekdays(symbol).filter(([d]) => d !== '2026-10-26');
  const timestamp = [...b.map(([d]) => Date.parse(`${d}T07:00:00Z`) / 1000), Date.parse('2026-11-04T07:00:00Z') / 1000];
  const close = [...b.map(([, v]) => v), null];
  const meta = { currency: 'EUR', symbol, exchangeTimezoneName: 'Europe/Berlin' };
  const result = { meta, timestamp, indicators: { quote: [{ close }], adjclose: [{ adjclose: close }] } };
  return new Response(JSON.stringify({ chart: { result: [result], error: null } }), { status: 200 });
}

function vanguard(id, isin) {
  if (vanguardMode === 'down') throw refused();
  if (vanguardMode === `bad:${id}`) return new Response(notFound, { status: 404, headers: { 'content-type': 'text/html' } });
  const fund = catalogue.find((f) => f.isin === isin);
  return new Response(vanguardPage(isin, weekdays(fund.sources.yahoo).slice(-10)), { status: 200, headers: { 'content-type': 'text/html' } });
}

globalThis.fetch = async (input) => {
  const url = String(input);
  const chart = /chart\/([^?]+)/.exec(url);
  if (chart) return yahoo(decodeURIComponent(chart[1]));
  const page = /\/product\/fund\/(?:equity|bond)\/(\d+)\/([A-Z0-9]+)$/.exec(url);
  if (page) return vanguard(page[1], page[2]);
  throw new Error(`the stub does not answer ${url}`);
};
