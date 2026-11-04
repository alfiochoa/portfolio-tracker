// A Vanguard product page built from bars, in the shape of the real ones beside it (the
// Historical Prices table, newest first, and the serverApp-state carrying the ISIN and the
// latest NAV), for the tests that stub the network. The parser itself is tested on the real pages.
import type { Bar } from '../../../src/lib/yahoo.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** `2026-11-03` -> `03 Nov 2026`, as the page prints it. */
const printed = (date: string): string => `${date.slice(8, 10)} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

export function vanguardPage(isin: string, bars: readonly Bar[]): string {
  const [asOfDate, price] = bars.at(-1)!;
  const rows = [...bars]
    .reverse()
    .map(([d, v]) => `<tr><th scope="row"> ${printed(d)} </th><td class="numeric"> €${v.toFixed(4)} </td><!----></tr>`)
    .join('');
  const state = {
    '2712145663': {
      b: { data: { funds: [{ pricingDetails: { navPrices: { items: [{ measureTypeCode: 'NAV', asOfDate, currencyCode: 'EUR', price }] } } }] } },
      u: '/gpx/graphql',
    },
    'gpx.fund-facts': { isin: { value: isin, type: 'value' } },
  };
  return [
    '<!DOCTYPE html><html lang="en"><head><title>Stub fund | Vanguard UK Professional</title></head><body>',
    '<h5 class="h-l">Historical Prices</h5><div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Date</th>',
    `<th scope="col" class="numeric"> NAV (EUR) </th></tr></thead><tbody>${rows}</tbody></table></div>`,
    `<script id="serverApp-state" type="application/json">${JSON.stringify(state)}</script>`,
    '</body></html>',
  ].join('\n');
}
