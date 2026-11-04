// Vanguard's product page parser, against pages saved from vanguard.co.uk on 2026-11-05
// (tests/fixtures/vanguard/, each trimmed as its opening comment says).
//
// The values are the ones T-003 compared with Yahoo's bars: US 500 €597.1246 on 03 Nov 2026 and
// €611.9205 on 27 Oct 2026, Euro Government Bond €112.1871 and €111.8750 on the same dates. The
// pages also list 26 Oct 2026, the day Yahoo has no price for (US 500 €606.4686).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isoDate, navValue, parseProductPage, productUrl } from '../src/lib/vanguard.ts';
import { SourceError } from '../src/lib/yahoo.ts';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/vanguard/${name}.html`, import.meta.url), 'utf8');
const US500 = 'IE00BFPM9V94';
const EUROGOV = 'IE00BFPM9W02';
const us500 = () => fixture(`us500-${US500}`);
const eurogov = () => fixture(`eurogov-${EUROGOV}`);

/** The page with one piece of its text replaced; fails if the piece is not there exactly once. */
function doctor(html: string, from: string, to: string): string {
  expect(html.split(from), `"${from}" should appear once`).toHaveLength(2);
  return html.replace(from, to);
}

/** The refusal's message, asserting it is a SourceError. */
function refusal(html: string, isin: string): string {
  try {
    parseProductPage(html, isin);
  } catch (e) {
    expect(e).toBeInstanceOf(SourceError);
    return (e as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('parseProductPage on real pages', () => {
  it('reads the US 500 (equity) table, ascending, with the page’s exact decimals and 26 Oct', () => {
    const page = parseProductPage(us500(), US500);
    expect(page.asOfDate).toBe('2026-11-03');
    expect(page.bars).toEqual([
      ['2026-10-21', 610.2842],
      ['2026-10-22', 604.3398],
      ['2026-10-23', 600.8708],
      ['2026-10-26', 606.4686],
      ['2026-10-27', 611.9205],
      ['2026-10-28', 613.8957],
      ['2026-10-29', 610.7378],
      ['2026-10-30', 599.6681],
      ['2026-11-02', 594.82], // printed €594.8200
      ['2026-11-03', 597.1246],
    ]);
  });

  it('reads the Euro Government Bond (bond) table', () => {
    const page = parseProductPage(eurogov(), EUROGOV);
    expect(page.asOfDate).toBe('2026-11-03');
    expect(page.bars).toHaveLength(10);
    const nav = new Map(page.bars);
    expect(nav.get('2026-11-03')).toBe(112.1871);
    expect(nav.get('2026-10-27')).toBe(111.875); // printed €111.8750
    expect(nav.get('2026-10-26')).toBe(111.8038);
    expect(page.bars[0]).toEqual(['2026-10-21', 111.2458]);
  });

  it('picks the Historical Prices table, not the page’s other tables', () => {
    expect(us500()).toMatch(/Market allocation[\s\S]*<table[\s\S]*Historical Prices/);
    expect(parseProductPage(us500(), US500).bars.every(([, v]) => v > 500)).toBe(true);
  });
});

describe('parseProductPage refuses', () => {
  it('a 404 page (the real body) and a page without the state', () => {
    expect(refusal(fixture('not-found'), EUROGOV)).toBe('the page does not name its ISIN');
    expect(refusal('<html><body>Access denied</body></html>', EUROGOV)).toBe('the page has no serverApp-state (not a product page)');
    expect(refusal(doctor(us500(), '<script id="serverApp-state" type="application/json">{', '<script id="serverApp-state" type="application/json">{{'), US500)).toBe(
      'the page’s serverApp-state is not JSON',
    );
  });

  it('a page for another ISIN than asked (Vanguard serves the id’s fund whatever ISIN the URL has)', () => {
    expect(refusal(us500(), EUROGOV)).toBe(`the page is for ${US500}, not ${EUROGOV}`);
    expect(refusal(doctor(us500(), '"isin":{"value":"IE00BFPM9V94"', '"isin":{"value":"IE00BFPM9V95"'), US500)).toBe(
      `the page is for IE00BFPM9V95, not ${US500}`,
    );
  });

  it('a page whose table is absent or empty', () => {
    expect(refusal(doctor(us500(), '>Historical Prices</h5>', '>Prices</h5>'), US500)).toBe('the page has no Historical Prices table');
    const empty = us500().replace(/(>Historical Prices<\/h5>[\s\S]*?<tbody[^>]*>)[\s\S]*?(<\/tbody>)/, '$1$2');
    expect(refusal(empty, US500)).toBe('the Historical Prices table has no rows');
  });

  it('a NAV that is not a positive finite number', () => {
    for (const nav of ['€0.0000', '€-594.8200', '€', 'n/a', '£594.8200', '€594,82', '€Infinity', '€5e2']) {
      expect(refusal(doctor(us500(), '> €594.8200 <', `> ${nav} <`), US500), nav).toBe(
        `the NAV on 2026-11-02 is ${JSON.stringify(nav)}, not a positive number`,
      );
    }
  });

  it('a date that is not a calendar date', () => {
    for (const date of ['31 Oct 2026x', '30 Feb 2026', '31 Sept 2026', '00 Nov 2026', '02 Noe 2026', '2026-11-02', 'Nov 02, 2026']) {
      expect(refusal(doctor(us500(), '> 02 Nov 2026 <', `> ${date} <`), US500), date).toBe(
        `the price table has a date that is not a calendar date: ${JSON.stringify(date)}`,
      );
    }
  });

  it('two rows on one date', () => {
    expect(refusal(doctor(us500(), '> 23 Oct 2026 <', '> 22 Oct 2026 <'), US500)).toBe('the price table has two rows for 2026-10-22');
  });

  it('a table whose newest row is not the latest NAV the page’s state gives', () => {
    expect(refusal(doctor(us500(), '> €597.1246 <', '> €597.1247 <'), US500)).toBe(
      "the price table's newest row (2026-11-03 597.1247) is not the page's latest NAV (2026-11-03 597.1246)",
    );
  });

  it('a latest NAV in another currency', () => {
    expect(refusal(us500().replaceAll('"currencyCode":"EUR"', '"currencyCode":"GBP"'), US500)).toBe('the latest NAV is in "GBP", not EUR');
  });
});

describe('the pieces', () => {
  it('isoDate reads the page’s dates with a fixed month table', () => {
    expect(isoDate('03 Nov 2026')).toBe('2026-11-03');
    expect(isoDate('30 Sept 2026')).toBe('2026-09-30');
    expect(isoDate('30 Sep 2026')).toBe('2026-09-30');
    expect(isoDate('1 Jan 2027')).toBe('2027-01-01');
    expect(isoDate('29 Feb 2028')).toBe('2028-02-29');
    expect(isoDate('29 Feb 2027')).toBeNull();
    expect(isoDate('03 November 2026')).toBeNull();
  });

  it('navValue reads euros with thousands separators, and nothing else', () => {
    expect(navValue('€597.1246')).toBe(597.1246);
    expect(navValue('€1,023.4500')).toBe(1023.45);
    expect(navValue('112.1871')).toBe(112.1871);
    expect(navValue('€0')).toBeNull();
    expect(navValue('€1,02.3')).toBeNull();
  });

  it('productUrl is the page T-003 checked', () => {
    expect(productUrl('equity', '9186', US500)).toBe(`https://www.vanguard.co.uk/professional/product/fund/equity/9186/${US500}`);
    expect(productUrl('bond', '9187', EUROGOV)).toBe(`https://www.vanguard.co.uk/professional/product/fund/bond/9187/${EUROGOV}`);
  });
});
