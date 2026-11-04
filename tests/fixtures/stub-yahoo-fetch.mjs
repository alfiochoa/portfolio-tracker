// Preloaded (node --import) by the process tests of `npm run snapshots`: Yahoo is answered from
// here, never from the network, and the script's pauses and retry waits are skipped.
//   STUB_YAHOO=healthy          every chart request gets 131 weekday bars to 2026-11-03
//   STUB_YAHOO=down             every request fails like a closed port
//   STUB_YAHOO=bad:<symbol>     that symbol gets Yahoo's 404 body, the others are healthy
const mode = process.env.STUB_YAHOO ?? 'healthy';

const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);

function bars(symbol) {
  const base = 100 + symbol.charCodeAt(9);
  const out = [];
  for (let d = Date.parse('2026-05-04T07:00:00Z'), i = 0; d <= Date.parse('2026-11-03T07:00:00Z'); d += 86_400_000) {
    const day = new Date(d).getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push([d / 1000, Math.round((base + i++ * 0.37) * 1e4) / 1e4]);
  }
  return out;
}

globalThis.fetch = async (input) => {
  const symbol = decodeURIComponent(/chart\/([^?]+)/.exec(String(input))[1]);
  if (mode === 'down') throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) });
  if (mode === `bad:${symbol}`) {
    const body = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };
    return new Response(JSON.stringify(body), { status: 404 });
  }
  const b = bars(symbol);
  const timestamp = [...b.map(([t]) => t), Date.parse('2026-11-04T07:00:00Z') / 1000];
  const close = [...b.map(([, v]) => v), null];
  const meta = { currency: 'EUR', symbol, exchangeTimezoneName: 'Europe/Berlin' };
  const result = { meta, timestamp, indicators: { quote: [{ close }], adjclose: [{ adjclose: close }] } };
  return new Response(JSON.stringify({ chart: { result: [result], error: null } }), { status: 200 });
};
