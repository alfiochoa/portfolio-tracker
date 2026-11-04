// Vanguard UK's product page (/professional/product/fund/<equity|bond>/<id>/<ISIN>) -> the last
// ten official NAVs. Pure: it takes the page's HTML and returns bars or throws a SourceError
// saying why not.
//
// What the page holds (checked 2026-11-05 on all eight funds): it is rendered on the server, so
// the HTML that comes back from one GET already has everything, no script needs to run.
//  - A "Historical Prices" section whose <table class="data-table"> lists the last ten NAVs,
//    newest first, one row each: `<th scope="row"> 03 Nov 2026 </th><td class="numeric"> €597.1246 </td>`.
//    These ten are only in the table: the page's JSON state does not carry them.
//  - The page's JSON state, `<script id="serverApp-state" type="application/json">`, which carries
//    the fund's ISIN (`"isin":{"value":"IE00BFPM9V94"}`) and its latest NAV
//    (`"navPrices":{"items":[{"asOfDate":"2026-11-03","currencyCode":"EUR","price":597.1246}]}`).
// The table is parsed for the bars; the state is the anchor: the ISIN must be the one asked for
// (the page is found by its id, and a wrong ISIN in the URL still serves the id's fund), and the
// table's newest row must be the state's latest NAV, which also proves it is the right table.
import { EXPECTED_CURRENCY, SourceError, type Bar } from './yahoo.ts';
import type { Kind } from './portfolio.ts';

export interface ProductPage {
  /** The date of the latest NAV, as the page's state gives it, YYYY-MM-DD. */
  asOfDate: string;
  /** The page's NAV table, ascending by date, one per date, NAVs as the page prints them. */
  bars: Bar[];
}

export const productUrl = (kind: Kind, id: string, isin: string): string =>
  `https://www.vanguard.co.uk/professional/product/fund/${kind}/${encodeURIComponent(id)}/${encodeURIComponent(isin)}`;

/** English month abbreviations as the page prints them ("Sept" as well as "Sep"). */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** `03 Nov 2026` -> `2026-11-03`, or null when it is not a date the calendar has. */
export function isoDate(text: string): string | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3,4})\.? (\d{4})$/.exec(text);
  const month = m ? MONTHS[m[2]!.toLowerCase()] : undefined;
  if (!m || month === undefined) return null;
  const day = Number(m[1]);
  const year = Number(m[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `€1,023.4567` -> 1023.4567, or null when it is not a positive finite number in euros. */
export function navValue(text: string): number | null {
  const m = /^(?:€|EUR)?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/.exec(text);
  if (!m) return null;
  const value = Number(`${m[1]!.replaceAll(',', '')}${m[2] ?? ''}`);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A cell's text: tags and comments gone, the few entities the page uses decoded, spaces collapsed. */
function cellText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&euro;|&#8364;|&#x20ac;/gi, '€')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Every value under a key named `key`, anywhere in the JSON. */
function valuesOf(json: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(json)) for (const x of json) valuesOf(x, key, out);
  else if (isRecord(json)) {
    for (const [k, v] of Object.entries(json)) {
      if (k === key) out.push(v);
      valuesOf(v, key, out);
    }
  }
  return out;
}

/** The page's JSON state, parsed. */
function pageState(html: string): unknown {
  const m = /<script\b[^>]*\bid="serverApp-state"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new SourceError('the page has no serverApp-state (not a product page)');
  try {
    return JSON.parse(m[1]!);
  } catch {
    throw new SourceError('the page’s serverApp-state is not JSON');
  }
}

/** The ten rows of the Historical Prices table, as the page orders them (newest first). */
function tableRows(html: string): { date: string; nav: string }[] {
  const heading = /<h\d\b[^>]*>\s*Historical Prices\s*<\/h\d>/i.exec(html);
  if (!heading) throw new SourceError('the page has no Historical Prices table');
  const start = html.indexOf('<table', heading.index);
  const end = start < 0 ? -1 : html.indexOf('</table>', start);
  if (end < 0) throw new SourceError('the page has no Historical Prices table');
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html.slice(start, end));
  const rows: { date: string; nav: string }[] = [];
  for (const [, row] of (body?.[1] ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row!.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((c) => cellText(c[2]!));
    if (cells.length < 2) throw new SourceError(`a row of the price table has ${cells.length} cells, not a date and a NAV`);
    rows.push({ date: cells[0]!, nav: cells[1]! });
  }
  if (rows.length === 0) throw new SourceError('the Historical Prices table has no rows');
  return rows;
}

/**
 * The NAV table of one fund's product page, checked against the page's own state. Refuses
 * (SourceError) a page without the table or the state, a page for another ISIN than `isin`, a
 * row whose date is not a calendar date or whose NAV is not a positive finite number, two rows
 * on one date, a latest NAV not in euros, and a table whose newest row is not the state's latest NAV.
 */
export function parseProductPage(html: string, isin: string): ProductPage {
  const state = pageState(html);

  const isins = new Set(valuesOf(state, 'isin').flatMap((v) => (isRecord(v) && typeof v.value === 'string' ? [v.value] : [])));
  if (isins.size === 0) throw new SourceError('the page does not name its ISIN');
  if (isins.size > 1) throw new SourceError(`the page names several ISINs: ${[...isins].join(', ')}`);
  const [pageIsin] = isins;
  if (pageIsin !== isin) throw new SourceError(`the page is for ${pageIsin}, not ${isin}`);

  const latest = valuesOf(state, 'navPrices').flatMap((v) => (isRecord(v) && Array.isArray(v.items) ? v.items : []));
  const navs = new Map<string, unknown>();
  for (const item of latest) {
    if (!isRecord(item) || typeof item.asOfDate !== 'string') continue;
    if (item.currencyCode !== EXPECTED_CURRENCY) {
      throw new SourceError(`the latest NAV is in ${JSON.stringify(item.currencyCode ?? null)}, not ${EXPECTED_CURRENCY}`);
    }
    navs.set(`${item.asOfDate} ${String(item.price)}`, item);
  }
  if (navs.size !== 1) throw new SourceError(navs.size ? `the page gives ${navs.size} different latest NAVs` : 'the page gives no latest NAV (navPrices)');
  const [anchor] = navs.values() as Iterable<{ asOfDate: string; price: unknown }>;
  const asOfDate = anchor!.asOfDate;

  const bars: Bar[] = [];
  for (const row of tableRows(html)) {
    const date = isoDate(row.date);
    if (date === null) throw new SourceError(`the price table has a date that is not a calendar date: ${JSON.stringify(row.date)}`);
    const nav = navValue(row.nav);
    if (nav === null) throw new SourceError(`the NAV on ${date} is ${JSON.stringify(row.nav)}, not a positive number`);
    bars.push([date, nav]);
  }
  bars.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 1; i < bars.length; i++) {
    if (bars[i]![0] === bars[i - 1]![0]) throw new SourceError(`the price table has two rows for ${bars[i]![0]}`);
  }

  const [newestDate, newestNav] = bars.at(-1)!;
  if (newestDate !== asOfDate || newestNav !== anchor!.price) {
    throw new SourceError(
      `the price table's newest row (${newestDate} ${newestNav}) is not the page's latest NAV (${asOfDate} ${String(anchor!.price)})`,
    );
  }
  return { asOfDate, bars };
}
