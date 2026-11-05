// The returns (SPEC "Returns"): the five performance tiles and the positions table's return cells, checked
// against returns worked out by hand from e2e/fixtures/prices.json (the arithmetic is in the comments below),
// with a fund that lags, with snapshots the page must not trust, and with too little history for a window.
// That every value fits its tile or chip, in each view, is views.spec.ts's.
import { expect, open, mutate, probe, SHORT_HISTORY, test, evidence, type Snapshot } from './helpers';

/*
 * The fixture, by hand. Every equity fund moves as `a`, every bond fund as `b` (each at its own
 * NAV level, so the ratios are the same); us500 alone has 2026-10-26, which is dropped.
 *
 *   date        a    b       L = 2026-11-03; T = 2026-11-04, after L, so P_i(T) = P_i(L) and V(L) = 1.
 *   2026-09-01  100  52      E = Σ equity weights = 0.9033789478903268, B = Σ bond weights = 0.0966210521096733
 *   2026-10-01  110  50      V(S) = E·a(S)/110 + B·b(S)/50, and the return is 1/V(S) − 1:
 *   2026-10-27  115  50.5      1d S = 2026-11-02: E·111/110 + B·50.1/50 = 1.0084058 -> −0.8336 % -> −0.83 %
 *   2026-10-28  114  50.4      5d S = 2026-10-27: E·115/110 + B·50.5/50 = 1.0420289 -> −4.0334 % -> −4.03 %
 *   2026-10-29  113  50.3      1w S = 2026-10-27 (L − 7), the same
 *   2026-10-30  112  50.2      1m S = 2026-10-01 (2026-10-03 is a Saturday): E + B = 1  ->  0.00 %
 *   2026-11-02  111  50.1      2m S = 2026-09-01 (2026-09-03 is not in the series):
 *   2026-11-03  110  50                     E·100/110 + B·52/50 = 0.9217395 -> +8.4905 % -> +8.49 %
 *
 * Two cells: US 500 over 1d is 110/111 − 1 = −0.90 %; Eurozone Inflation-Linked over 2m is 50/52 − 1 = −3.85 %.
 */
const TILES = [
  ['1d', '−0.83 %', '2026-11-02', 'down', '1 day'],
  ['5d', '−4.03 %', '2026-10-27', 'down', '5 days'],
  ['1w', '−4.03 %', '2026-10-27', 'down', '1 week'],
  ['1m', '0.00 %', '2026-10-01', 'flat', '1 month'],
  ['2m', '+8.49 %', '2026-09-01', 'up', '2 months'],
] as const;

test('the tiles and the table show the returns computed by hand from the fixture', async ({ page }, testInfo) => {
  await open(page);
  // us500 alone has 2026-10-26, so the series drops it inside the 2m window: PARTIAL (badge.spec.ts).
  await expect(page.locator('.badge')).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH · PARTIAL');
  await expect(page.locator('footer')).toContainText('Prices: fund NAVs from Yahoo Finance (unofficial), snapshot of 2026-11-04 06:30 UTC');

  const performance = page.getByRole('region', { name: 'Performance' });
  await expect(performance.locator('.tile')).toHaveCount(5);
  for (const [window, value, start, sign, label] of TILES) {
    const tile = performance.locator(`.tile[data-window="${window}"]`);
    await expect(tile.locator('.tile-label')).toHaveText(label);
    await expect(tile.locator('.tile-value')).toHaveText(value);
    await expect(tile.locator('time')).toHaveText(start);
    await expect(tile).toHaveAttribute('data-sign', sign);
  }
  // The colour is the token for the sign; 0.00 % takes neither.
  const tileColour = (w: string) => performance.locator(`.tile[data-window="${w}"] .tile-value`).evaluate((e) => getComputedStyle(e).color);
  const [up, down] = [await probe(page, 'var(--up)'), await probe(page, 'var(--down)')];
  expect(await tileColour('1d')).toBe(down);
  expect(await tileColour('2m')).toBe(up);
  expect([up, down]).not.toContain(await tileColour('1m'));

  const positions = page.getByRole('region', { name: 'Positions' });
  await expect(positions.locator('tr[data-fund="us500"] .ret[data-window="1d"]')).toHaveText('−0.90 %');
  await expect(positions.locator('tr[data-fund="euroinfl"] .ret[data-window="2m"]')).toHaveText('−3.85 %');
  const total = await positions.locator('.total .ret').allTextContents();
  expect(total).toEqual(TILES.map(([, value]) => value));
  for (const text of await positions.locator('td.ret').allTextContents()) expect(text).toMatch(/^([+−]\d+\.\d\d|0\.00) %$/);

  // The chart (the 2m index, by hand: V(S_2m) = 0.9217395, so 100 on 2026-09-01 and 108.49 on L)
  // and the sparklines are chart.spec.ts's.
  await evidence(page, testInfo.project.name, 'loaded');
});

/*
 * A fund that lags (verifier, T-004). Drop japan's 2026-11-03 bar: L falls back to 2026-11-02, which is before the
 * anchor T = 2026-11-04, so P_i(T) is each fund's last NAV on or before T, and japan's (166.5, the a = 111 level) is
 * not the others' (a = 110): V(L) is no longer 1. With E the equity weights, w_j japan's and B the bonds':
 *
 *   V(t) = (E − w_j)·a(t)/110 + w_j·a(t)/111 + B·b(t)/50          (a, b as in the table above)
 *   series: 09-01, 10-01, 10-27, 10-28, 10-29, 10-30, 11-02 (10-26 dropped); 5d counts back to 10-01, and so does
 *   1w (L − 7 = 10-26, dropped) and 1m (10-02, a Friday); 2m is 09-02, so 09-01.
 *   1d  S 10-30: V(L)/V(S) − 1 = −0.8266 %   5d/1w/1m S 10-01: +0.8405 %   2m S 09-01: +9.4014 %
 *   (exact fractions, worked out in Python from the weights in data/portfolio.json)
 * Cells: japan 1d = 166.5/168 − 1 = −0.89 %; Eurozone Inflation-Linked 2m = 25.05/26 − 1 = −3.65 %.
 */
test('with a fund one day behind, the windows end at the earlier date and the anchor is each fund\'s own last NAV', async ({ page }) => {
  await open(page, (text) => mutate(text, (s) => s.funds.japan!.bars.pop()));
  const performance = page.getByRole('region', { name: 'Performance' });
  const expected = [
    ['1d', '−0.83 %', '2026-10-30'],
    ['5d', '+0.84 %', '2026-10-01'],
    ['1w', '+0.84 %', '2026-10-01'],
    ['1m', '+0.84 %', '2026-10-01'],
    ['2m', '+9.40 %', '2026-09-01'],
  ];
  for (const [window, value, start] of expected) {
    const tile = performance.locator(`.tile[data-window="${window}"]`);
    await expect(tile.locator('.tile-value')).toHaveText(value!);
    await expect(tile.locator('time')).toHaveText(start!);
  }
  const positions = page.getByRole('region', { name: 'Positions' });
  await expect(positions.locator('tr[data-fund="japan"] .ret[data-window="1d"]')).toHaveText('−0.89 %');
  await expect(positions.locator('tr[data-fund="euroinfl"] .ret[data-window="2m"]')).toHaveText('−3.65 %');
});

// A snapshot the page cannot trust shows no number at all, never a wrong one, and the allocation stays.
// (An HTTP 500 and JSON that does not parse are page.spec.ts's unreadable state, with the same checks.)
const BAD_SNAPSHOTS: [string, Snapshot][] = [
  ['an empty object', () => '{}'],
  ['an HTML page with status 200', () => '<!doctype html><html><body>hello</body></html>'],
  ['a portfolio fund missing', (t) => mutate(t, (s) => delete s.funds.japan)],
  ['a fund without bars', (t) => mutate(t, (s) => (s.funds.japan!.bars = []))],
  ['a NAV of zero', (t) => mutate(t, (s) => (s.funds.japan!.bars[3]![1] = 0))],
  ['a NAV that is a string', (t) => mutate(t, (s) => (s.funds.japan!.bars[3]![1] = '5' as unknown as number))],
  ['bars out of order', (t) => mutate(t, (s) => s.funds.japan!.bars.reverse())],
];

for (const [name, snapshot] of BAD_SNAPSHOTS) {
  test(`with ${name} for a snapshot, the page says it is unreadable and shows no return`, async ({ page }) => {
    await open(page, snapshot);
    await expect(page.locator('.badge')).toContainText('prices unreadable');
    const performance = page.getByRole('region', { name: 'Performance' });
    await expect(performance.locator('.placeholder')).toContainText('could not be read');
    await expect(performance.locator('.tile')).toHaveCount(0);
    await expect(performance).not.toContainText('%');
    const positions = page.getByRole('region', { name: 'Positions' });
    for (const text of await positions.locator('td.ret').allTextContents()) expect(text).toBe('—');
    await expect(positions.locator('.total .weight')).toHaveText('100.00 %');
    await expect(page.getByRole('region', { name: 'Allocation' }).getByText('Equities 90.34 %')).toBeVisible();
  });
}

test('a window the series does not reach says "not enough history"', async ({ page }, testInfo) => {
  await open(page, SHORT_HISTORY);
  const performance = page.getByRole('region', { name: 'Performance' });
  await expect(performance.locator('.tile[data-window="5d"] .tile-value')).toHaveText('−4.03 %');
  for (const window of ['1m', '2m']) {
    const tile = performance.locator(`.tile[data-window="${window}"]`);
    await expect(tile.locator('.tile-value')).toHaveText('not enough history');
    await expect(tile.locator('.tile-start')).toHaveText('prices from 2026-10-27');
    await expect(page.locator(`.total .ret[data-window="${window}"]`)).toHaveText('not enough history');
  }
  // The chart covers what there is: six dates from 2026-10-27, indexed to 100 there.
  const chart = page.getByRole('region', { name: 'Portfolio value' });
  await expect(chart.locator('.chart-line')).toHaveAttribute('data-points', '6');
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /^Portfolio value index, from 100 on 2026-10-27 to /);
  await expect(chart.locator('.section-note')).toContainText('Prices start on 2026-10-27');
  await expect(page.locator('tr[data-fund="us500"] .sparkline')).toHaveAttribute('aria-label', /^US 500, return since 2026-10-27: /);
  // That nothing overflows with a short history is views.spec.ts's, in each view.
  await evidence(page, testInfo.project.name, 'short');
});
