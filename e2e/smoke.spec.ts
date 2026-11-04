// The built site renders every section in each snapshot state, at each size and theme (playwright.config.ts projects).
// Set EVIDENCE_DIR to also save a full-page screenshot per project.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SECTIONS = ['Performance', 'Portfolio value, last two months', 'Positions', 'Allocation'];

// The page reads only its own files: anything else is aborted, and fails the test after it.
// The snapshot is always a fixture (e2e/fixtures/prices.json) or a stand-in, so the numbers are known.
let outside: string[] = [];
let errors: string[] = [];
const FIXTURE = readFileSync(path.join(import.meta.dirname, 'fixtures', 'prices.json'), 'utf8');

type Snapshot = 'fixture' | 'missing' | 'unreadable' | 'http500' | ((text: string) => string);

async function open(page: Page, snapshot: Snapshot = 'fixture'): Promise<void> {
  await page.route('**/data/prices.json', (route) => {
    if (snapshot === 'missing') return route.fulfill({ status: 404, body: 'Not Found' });
    if (snapshot === 'http500') return route.fulfill({ status: 500, body: 'boom' });
    if (snapshot === 'unreadable') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"generatedAt": "2026-11' });
    const body = typeof snapshot === 'function' ? snapshot(FIXTURE) : FIXTURE;
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.goto('/');
  await expect(page.locator('#app > *').first()).toBeVisible();
  expect(errors, 'errors thrown on the page').toEqual([]);
}

test.beforeEach(async ({ page, baseURL }) => {
  outside = [];
  errors = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(baseURL!)) return route.continue();
    outside.push(url);
    return route.abort();
  });
  page.on('pageerror', (e) => errors.push(e.message));
});

test.afterEach(() => {
  expect(outside, 'requests outside the site').toEqual([]);
  expect(errors, 'errors thrown on the page').toEqual([]);
});

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
  ['1d', '−0.83 %', '2026-11-02', 'down'],
  ['5d', '−4.03 %', '2026-10-27', 'down'],
  ['1w', '−4.03 %', '2026-10-27', 'down'],
  ['1m', '0.00 %', '2026-10-01', 'flat'],
  ['2m', '+8.49 %', '2026-09-01', 'up'],
] as const;

test('the tiles and the table show the returns computed by hand from the fixture', async ({ page }, testInfo) => {
  await open(page);
  await expect(page.locator('.badge')).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC');

  const performance = page.getByRole('region', { name: 'Performance' });
  await expect(performance.locator('.tile')).toHaveCount(5);
  for (const [window, value, start, sign] of TILES) {
    const tile = performance.locator(`.tile[data-window="${window}"]`);
    await expect(tile.locator('.tile-label')).toHaveText(window);
    await expect(tile.locator('.tile-value')).toHaveText(value);
    await expect(tile.locator('time')).toHaveText(start);
    await expect(tile).toHaveAttribute('data-sign', sign);
  }
  // The colour is the token for the sign; 0.00 % takes neither.
  const colours = await page.evaluate(() => {
    const probe = (value: string) => {
      const el = document.createElement('span');
      el.style.color = value;
      document.body.append(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    const tile = (w: string) => getComputedStyle(document.querySelector(`.tile[data-window="${w}"] .tile-value`)!).color;
    return { up: probe('var(--up)'), down: probe('var(--down)'), d1: tile('1d'), m1: tile('1m'), m2: tile('2m') };
  });
  expect(colours.d1).toBe(colours.down);
  expect(colours.m2).toBe(colours.up);
  expect([colours.up, colours.down]).not.toContain(colours.m1);

  const positions = page.getByRole('region', { name: 'Positions' });
  await expect(positions.locator('tr[data-fund="us500"] .ret[data-window="1d"]')).toHaveText('−0.90 %');
  await expect(positions.locator('tr[data-fund="euroinfl"] .ret[data-window="2m"]')).toHaveText('−3.85 %');
  const total = await positions.locator('.total .ret').allTextContents();
  expect(total).toEqual(TILES.map(([, value]) => value));
  for (const text of await positions.locator('td.ret').allTextContents()) expect(text).toMatch(/^([+−]\d+\.\d\d|0\.00) %$/);

  // Every value fits its own box, the widest (+10.00 %, the bold total) included: nothing runs into its neighbour.
  const spills = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('td.ret, .tile-value')]
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => `${el.closest('tr')?.dataset.fund ?? 'tile'} ${el.dataset.window ?? ''}: ${el.textContent}`),
  );
  expect(spills, 'values wider than their cell').toEqual([]);

  // The chart (the 2m index, by hand: V(S_2m) = 0.9217395, so 100 on 2026-09-01 and 108.49 on L)
  // and the sparklines are the next test's.

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (process.env.EVIDENCE_DIR) {
    await page.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-loaded.png`), fullPage: true });
  }
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
  await open(page, (text) => {
    const s = JSON.parse(text) as { funds: Record<string, { bars: [string, number][] }> };
    s.funds.japan!.bars.pop();
    return JSON.stringify(s);
  });
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
const BAD_SNAPSHOTS: [string, Snapshot][] = [
  ['an HTTP 500', 'http500'],
  ['an empty object', () => '{}'],
  ['an HTML page with status 200', () => '<!doctype html><html><body>hello</body></html>'],
  ['a portfolio fund missing', (t) => mutate(t, (s) => delete s.funds.japan)],
  ['a fund without bars', (t) => mutate(t, (s) => (s.funds.japan!.bars = []))],
  ['a NAV of zero', (t) => mutate(t, (s) => (s.funds.japan!.bars[3]![1] = 0))],
  ['a NAV that is a string', (t) => mutate(t, (s) => (s.funds.japan!.bars[3]![1] = '5' as unknown as number))],
  ['bars out of order', (t) => mutate(t, (s) => s.funds.japan!.bars.reverse())],
];

function mutate(text: string, change: (s: { funds: Record<string, { bars: [string, number][] }> }) => unknown): string {
  const s = JSON.parse(text) as { funds: Record<string, { bars: [string, number][] }> };
  change(s);
  return JSON.stringify(s);
}

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

/*
 * The chart, by hand from the same fixture: the 2m window is 2026-09-01 to 2026-11-03, eight series
 * dates (us500's 2026-10-26 is dropped), each V(t)/V(S) × 100 with V(S) = 0.9217395:
 *   2026-09-01 100.00 · 2026-10-01 108.49 · 2026-10-27 113.05 · 2026-11-02 109.40 · 2026-11-03 108.49
 */
test.describe('the chart', () => {
  test.use({ hasTouch: true }); // so the phone can tap; the laptop still hovers with a mouse

  test('draws the 2m index with its labels, and the sparklines', async ({ page }, testInfo) => {
    await open(page);
    const region = page.getByRole('region', { name: 'Portfolio value, last two months' });
    await expect(region.locator('.placeholder')).toHaveCount(0);
    const svg = region.getByRole('img');
    await expect(svg).toHaveAttribute('aria-label', 'Portfolio value index, from 100 on 2026-09-01 to 108.49 on 2026-11-03.');
    const line = svg.locator('.chart-line');
    await expect(line).toHaveAttribute('data-points', '8');
    expect((await line.getAttribute('d'))!.match(/[ML]/g)).toHaveLength(8);
    await expect(svg.locator('.chart-end')).toHaveText('108.49');
    await expect(svg.locator('.chart-hundred')).toHaveCount(1);
    const yLabels = await svg.locator('.chart-y text').allTextContents();
    expect(yLabels.length).toBeGreaterThanOrEqual(3);
    expect(yLabels.length).toBeLessThanOrEqual(5);
    expect(yLabels).toContain('100');
    const xLabels = await svg.locator('.chart-x text').allTextContents();
    expect(xLabels[0]).toBe('2026-09-01');
    expect(xLabels.at(-1)).toBe('2026-11-03');
    expect(xLabels).toContain('Oct');
    await expect(svg.locator('.chart-axis line')).toHaveCount(3); // the axis and the two month boundaries

    // No label runs into another, or out of the SVG.
    const clashes = await svg.evaluate((el) => {
      const svgBox = el.getBoundingClientRect();
      const boxes = [...el.querySelectorAll('text')].map((t) => ({ text: t.textContent, r: t.getBoundingClientRect() }));
      const out: string[] = [];
      for (const a of boxes) {
        if (a.r.left < svgBox.left - 0.5 || a.r.right > svgBox.right + 0.5) out.push(`${a.text} leaves the chart`);
        for (const b of boxes) {
          if (a === b || a.text! > b.text!) continue;
          if (a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) out.push(`${a.text} / ${b.text}`);
        }
      }
      return out;
    });
    expect(clashes, 'overlapping labels').toEqual([]);
    // Full width on a phone; labels at their own size on every screen.
    const sizes = await svg.evaluate((el: SVGSVGElement) => ({
      svg: el.getBoundingClientRect().width,
      section: el.closest('section')!.getBoundingClientRect().width,
      font: parseFloat(getComputedStyle(el.querySelector('.chart-y text')!).fontSize),
      scale: el.getBoundingClientRect().width / el.viewBox.baseVal.width,
    }));
    expect(sizes.svg).toBeCloseTo(sizes.section, 0);
    expect(sizes.font * sizes.scale).toBeGreaterThanOrEqual(11.5);

    // A sparkline per fund, 64 × 20, coloured and labelled by its 2m return.
    const positions = page.getByRole('region', { name: 'Positions' });
    await expect(positions.locator('tbody .sparkline')).toHaveCount(8);
    const us500 = positions.locator('tr[data-fund="us500"] .sparkline');
    await expect(us500).toHaveAttribute('aria-label', 'US 500, 2m return: +10.00 %');
    await expect(us500).toHaveAttribute('data-sign', 'up');
    await expect(us500.locator('path')).toHaveAttribute('data-points', '9'); // its own line keeps 2026-10-26
    const infl = positions.locator('tr[data-fund="euroinfl"] .sparkline');
    await expect(infl).toHaveAttribute('aria-label', 'Eurozone Inflation-Linked Bond, 2m return: −3.85 %');
    await expect(infl).toHaveAttribute('data-sign', 'down');
    for (const box of await positions.locator('tbody .sparkline').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
      expect(box.width).toBe(64);
      expect(box.height).toBe(20);
    }
    const strokes = await page.evaluate(() => {
      const probe = (value: string) => {
        const el = document.createElement('span');
        el.style.color = value;
        document.body.append(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      };
      const stroke = (f: string) => getComputedStyle(document.querySelector(`tr[data-fund="${f}"] .sparkline path`)!).stroke;
      return { up: probe('var(--up)'), down: probe('var(--down)'), us500: stroke('us500'), infl: stroke('euroinfl') };
    });
    expect(strokes.us500).toBe(strokes.up);
    expect(strokes.infl).toBe(strokes.down);

    if (process.env.EVIDENCE_DIR) {
      await region.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-chart.png`) });
    }
  });

  test('reads a date on hover (laptop), on tap (phone) and with the arrow keys', async ({ page }, testInfo) => {
    await open(page);
    const svg = page.locator('svg.chart');
    const readout = page.locator('.chart-readout');
    await expect(readout).toHaveAttribute('data-state', 'idle');
    await expect(svg.locator('.chart-dot')).toHaveAttribute('visibility', 'hidden');

    // Aim at the third point (2026-10-27): its x in the SVG's units, scaled to the screen.
    const target = await svg.evaluate((el: SVGSVGElement) => {
      const d = el.querySelector('.chart-line')!.getAttribute('d')!;
      const [x, y] = d.split(/[ML]/).filter(Boolean)[2]!.trim().split(' ').map(Number) as [number, number];
      const r = el.getBoundingClientRect();
      const k = r.width / el.viewBox.baseVal.width;
      return { x: r.left + x * k + 1, y: r.top + y * k + 20 }; // off the line, and a pixel past the date (a phone has 4 px a day): the nearest date wins
    });
    if (testInfo.project.name.startsWith('phone')) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.move(target.x, target.y);
    await expect(readout).toHaveAttribute('data-state', 'active');
    await expect(readout).toHaveText('113.05 on 2026-10-27');
    await expect(svg.locator('.chart-dot')).toHaveAttribute('visibility', 'visible');
    if (process.env.EVIDENCE_DIR) {
      await page.locator('#chart').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-readout.png`) });
    }

    if (!testInfo.project.name.startsWith('phone')) {
      await page.mouse.move(0, 0); // the mouse leaves: the readout goes back to its hint
      await expect(readout).toHaveAttribute('data-state', 'idle');
    }

    // The keyboard: focus starts on the latest date, the arrows step through the dates.
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await svg.focus();
    await expect(readout).toHaveText('108.49 on 2026-11-03');
    await page.keyboard.press('ArrowLeft');
    await expect(readout).toHaveText('109.40 on 2026-11-02');
    await page.keyboard.press('Home');
    await expect(readout).toHaveText('100.00 on 2026-09-01');
    await page.keyboard.press('ArrowLeft');
    await expect(readout).toHaveText('100.00 on 2026-09-01');
    await page.keyboard.press('ArrowRight');
    await expect(readout).toHaveText('108.49 on 2026-10-01');
  });

  test('a snapshot of one date shows "not enough history" instead of a line', async ({ page }) => {
    await open(page, (text) => {
      const s = JSON.parse(text) as { funds: Record<string, { bars: [string, number][] }> };
      for (const f of Object.values(s.funds)) f.bars = f.bars.filter(([d]) => d === '2026-11-03');
      return JSON.stringify(s);
    });
    const region = page.getByRole('region', { name: 'Portfolio value, last two months' });
    await expect(region.locator('.placeholder')).toHaveText(/^Not enough history/);
    await expect(region.locator('svg')).toHaveCount(0);
    await expect(page.locator('tbody .sparkline')).toHaveCount(0);
  });
});

test('a window the series does not reach says "not enough history"', async ({ page }, testInfo) => {
  // Only the bars from 2026-10-27 on: six series dates, so 1d, 5d and 1w have a start, 1m and 2m do not.
  await open(page, (text) => {
    const s = JSON.parse(text) as { funds: Record<string, { bars: [string, number][] }> };
    for (const f of Object.values(s.funds)) f.bars = f.bars.filter(([d]) => d >= '2026-10-27');
    return JSON.stringify(s);
  });
  const performance = page.getByRole('region', { name: 'Performance' });
  await expect(performance.locator('.tile[data-window="5d"] .tile-value')).toHaveText('−4.03 %');
  for (const window of ['1m', '2m']) {
    const tile = performance.locator(`.tile[data-window="${window}"]`);
    await expect(tile.locator('.tile-value')).toHaveText('not enough history');
    await expect(tile.locator('.tile-start')).toHaveText('prices from 2026-10-27');
    await expect(page.locator(`.total .ret[data-window="${window}"]`)).toHaveText('not enough history');
  }
  // The chart covers what there is: six dates from 2026-10-27, indexed to 100 there.
  const chart = page.getByRole('region', { name: 'Portfolio value, last two months' });
  await expect(chart.locator('.chart-line')).toHaveAttribute('data-points', '6');
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /^Portfolio value index, from 100 on 2026-10-27 to /);
  await expect(chart.locator('.section-note')).toContainText('Prices start on 2026-10-27');
  await expect(page.locator('tr[data-fund="us500"] .sparkline')).toHaveAttribute('aria-label', /^US 500, return since 2026-10-27: /);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (process.env.EVIDENCE_DIR) {
    await page.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-short.png`), fullPage: true });
  }
});

for (const state of ['missing', 'unreadable'] as const) {
  test(`with the snapshot ${state}, the page shows the allocation and no return`, async ({ page }, testInfo) => {
    await open(page, state);
    await expect(page.locator('.badge')).toHaveText(
      state === 'missing' ? 'Allocation as of 2026-11-04 · no prices yet' : 'Allocation as of 2026-11-04 · prices unreadable · ERROR',
    );
    await expect(page.getByText('Funds price once a day; the NAV of a day is published the next working day.')).toBeVisible();
    // The sections the spec lists, in order.
    const titles = await page.locator('main h2').allTextContents();
    expect(titles).toEqual(SECTIONS);
    for (const name of SECTIONS) await expect(page.getByRole('region', { name })).toBeVisible();
    await expect(page.locator('footer')).toContainText('Not investment advice');
    await expect(page.locator('svg')).toHaveCount(0); // no chart, no sparkline
    // Performance and chart: a quiet placeholder, no number.
    const performance = page.getByRole('region', { name: 'Performance' });
    await expect(performance.locator('.placeholder')).toContainText(
      state === 'missing' ? 'Prices are not wired yet' : 'The price snapshot could not be read',
    );
    for (const name of ['Performance', 'Portfolio value, last two months']) {
      const region = page.getByRole('region', { name });
      await expect(region.locator('.placeholder')).toBeVisible();
      await expect(region).not.toContainText('%');
    }
    // Positions: eight funds, heaviest first, the return columns empty, a total of 100.00 %.
    const positions = page.getByRole('region', { name: 'Positions' });
    const rows = positions.locator('tbody tr');
    await expect(rows).toHaveCount(8);
    await expect(rows.first().locator('.class')).toHaveText('US equities');
    await expect(rows.first().locator('.fund-name')).toHaveText('US 500');
    await expect(rows.first().locator('.weight')).toHaveText('39.84 %');
    await expect(rows.last().locator('.weight')).toHaveText('2.54 %');
    await expect(positions.locator('tbody .ret')).toHaveCount(40);
    for (const text of await positions.locator('td.ret').allTextContents()) expect(text).toBe('—');
    await expect(positions.locator('.total .total-label')).toHaveText('Total');
    await expect(positions.locator('.total .weight')).toHaveText('100.00 %');
    // Allocation: equities against bonds, and eight asset classes.
    const allocation = page.getByRole('region', { name: 'Allocation' });
    await expect(allocation.getByText('Equities 90.34 %')).toBeVisible();
    await expect(allocation.getByText('Bonds 9.66 %')).toBeVisible();
    // As a person reads it, on one line each (innerText follows the layout, textContent does not).
    const legend = (await allocation.locator('.split-legend').innerText()).split('\n');
    expect(legend).toEqual(['Equities 90.34 %', 'Bonds 9.66 %']);
    await expect(allocation.locator('.class-row')).toHaveCount(8);
    // Nothing wider than the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (process.env.EVIDENCE_DIR) {
      await page.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-${state}.png`), fullPage: true });
    }
  });
}

test('a fund shows its full name on hover and on tap', async ({ page }, testInfo) => {
  await open(page);
  const longest = page.locator('tr[data-fund="euroinfl"]');
  const button = longest.locator('.fund-name');
  const full = 'Vanguard Eurozone Inflation-Linked Bond Index Euro - Institutional Plus';
  await expect(button).toHaveAttribute('title', new RegExp(`^${full}`));
  await expect(longest.locator('.fund-full')).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(longest.locator('.fund-full')).toBeVisible();
  await expect(longest.locator('.fund-full')).toContainText(full);
  if (process.env.EVIDENCE_DIR) {
    await longest.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-full-name.png`) });
  }
  await button.click();
  await expect(longest.locator('.fund-full')).toBeHidden();
});

test('the full name opens from the keyboard, and data-theme overrides the system theme', async ({ page }) => {
  await open(page);
  const row = page.locator('tr[data-fund="euroinfl"]');
  const button = row.locator('.fund-name');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('.fund-full')).toBeVisible();

  // A data-theme on <html> wins over prefers-color-scheme, in either direction.
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const system = await bg();
  for (const forced of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), forced);
    const forcedBg = await bg();
    expect(forcedBg).toBe(forced === 'dark' ? 'rgb(26, 26, 25)' : 'rgb(252, 252, 251)');
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  expect(await bg()).toBe(system);
});
