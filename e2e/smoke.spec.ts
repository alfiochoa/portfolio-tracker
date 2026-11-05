// The built site renders every section in each snapshot state, at each size and theme (playwright.config.ts projects).
// Set EVIDENCE_DIR to also save a full-page screenshot per project.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SECTIONS = ['Performance', 'Portfolio value', 'Positions', 'Allocation'];

// The page reads only its own files: anything else is aborted, and fails the test after it.
// The snapshot is always a fixture (e2e/fixtures/prices.json) or a stand-in, so the numbers are known.
let outside: string[] = [];
let errors: string[] = [];
const FIXTURE = readFileSync(path.join(import.meta.dirname, 'fixtures', 'prices.json'), 'utf8');

const LAGGING = readFileSync(path.join(import.meta.dirname, 'fixtures', 'prices-lagging.json'), 'utf8');

type Snapshot = 'fixture' | 'missing' | 'unreadable' | 'http500' | ((text: string) => string);

// The viewer is in Madrid, and the clock is the page's only one (src/main.ts): Wednesday 2026-11-04,
// noon in Madrid, unless a test says otherwise. The fixture's L is Tuesday 2026-11-03, so it is FRESH then.
test.use({ timezoneId: 'Europe/Madrid' });
const WEDNESDAY = '2026-11-04T11:00:00Z';

async function open(page: Page, snapshot: Snapshot = 'fixture', now: string = WEDNESDAY, at = '/'): Promise<void> {
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/data/prices.json', (route) => {
    if (snapshot === 'missing') return route.fulfill({ status: 404, body: 'Not Found' });
    if (snapshot === 'http500') return route.fulfill({ status: 500, body: 'boom' });
    if (snapshot === 'unreadable') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"generatedAt": "2026-11' });
    const body = typeof snapshot === 'function' ? snapshot(FIXTURE) : FIXTURE;
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.goto(at);
  await expect(page.locator('#app > *').first()).toBeVisible();
  // The page renders at once and again when the snapshot has answered: wait for the second.
  await expect(page.locator('.badge')).not.toHaveAttribute('data-state', 'loading');
  expect(errors, 'errors thrown on the page').toEqual([]);
}

/** The fixture with us500's lone 2026-10-26 taken out, so no date is dropped from the series: neither PARTIAL nor any return changes. */
const WITHOUT_DROPPED = (text: string): string => mutate(text, (s) => (s.funds.us500!.bars = s.funds.us500!.bars.filter(([d]) => d !== '2026-10-26')));

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
  ['1d', '−0.83 %', '2026-11-02', 'down', '1 day'],
  ['5d', '−4.03 %', '2026-10-27', 'down', '5 days'],
  ['1w', '−4.03 %', '2026-10-27', 'down', '1 week'],
  ['1m', '0.00 %', '2026-10-01', 'flat', '1 month'],
  ['2m', '+8.49 %', '2026-09-01', 'up', '2 months'],
] as const;

/**
 * Every value inside its box's padding: each tile's value inside its tile, each return inside its
 * chip (the text's own box, measured with a Range, so a value that runs past its cell is caught).
 */
async function spills(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const pairs: [Element, Element][] = [
      ...[...document.querySelectorAll('.tile-value')].map((v) => [v, v.closest('.tile')!] as [Element, Element]),
      ...[...document.querySelectorAll('.positions .chip')].map((c) => [c, c] as [Element, Element]),
    ];
    for (const [value, box] of pairs) {
      const range = document.createRange();
      range.selectNodeContents(value);
      const text = range.getBoundingClientRect();
      const r = box.getBoundingClientRect();
      const cs = getComputedStyle(box);
      const left = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
      const right = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      if (text.left < left - 0.5 || text.right > right + 0.5) {
        out.push(`${box.closest('tr')?.getAttribute('data-fund') ?? 'tile'} ${box.closest('[data-window]')?.getAttribute('data-window') ?? ''}: ${value.textContent} (${Math.round(text.right - right)} px past)`);
      }
    }
    return out;
  });
}

test('the tiles and the table show the returns computed by hand from the fixture', async ({ page }, testInfo) => {
  await open(page);
  // us500 alone has 2026-10-26, so the series drops it inside the 2m window: PARTIAL (the badge's own tests below).
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

  // Every value fits inside its tile's or chip's padding, the widest (+10.00 %, the bold total) included.
  expect(await spills(page), 'values wider than their cell').toEqual([]);

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

type Mutable = { warning?: string; funds: Record<string, { bars: [string, number][] }> };
function mutate(text: string, change: (s: Mutable) => unknown): string {
  const s = JSON.parse(text) as Mutable;
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
    const region = page.getByRole('region', { name: 'Portfolio value' });
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
    // The card's full inner width (reaching 8 px into its side padding on a Glance phone); labels at their own size on every screen.
    const sizes = await svg.evaluate((el: SVGSVGElement) => ({
      svg: el.getBoundingClientRect().width,
      section: ((sec: HTMLElement) => sec.getBoundingClientRect().width - parseFloat(getComputedStyle(sec).paddingLeft) - parseFloat(getComputedStyle(sec).paddingRight) - 2 * parseFloat(getComputedStyle(el.parentElement!).marginLeft))(el.closest('section')!),
      font: parseFloat(getComputedStyle(el.querySelector('.chart-y text')!).fontSize),
      scale: el.getBoundingClientRect().width / el.viewBox.baseVal.width,
    }));
    expect(Math.abs(sizes.svg - sizes.section)).toBeLessThan(1);
    expect(sizes.font * sizes.scale).toBeGreaterThanOrEqual(11.5);

    // A sparkline per fund, 80 × 24 (60 × 22 below 64rem), labelled by its 2m return; coloured by it in Desk (views.spec.ts), neutral in Glance.
    const positions = page.getByRole('region', { name: 'Positions' });
    await expect(positions.locator('tbody .sparkline')).toHaveCount(8);
    const us500 = positions.locator('tr[data-fund="us500"] .sparkline');
    await expect(us500).toHaveAttribute('aria-label', 'US 500, 2m return: +10.00 %');
    await expect(us500).toHaveAttribute('data-sign', 'up');
    await expect(us500.locator('.spark-line')).toHaveAttribute('data-points', '9'); // its own line keeps 2026-10-26
    const infl = positions.locator('tr[data-fund="euroinfl"] .sparkline');
    await expect(infl).toHaveAttribute('aria-label', 'Eurozone Inflation-Linked Bond, 2m return: −3.85 %');
    await expect(infl).toHaveAttribute('data-sign', 'down');
    for (const box of await positions.locator('tbody .sparkline').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
      expect(box.width).toBe(testInfo.project.name.startsWith('laptop') ? 80 : 60);
      expect(box.height).toBe(testInfo.project.name.startsWith('laptop') ? 24 : 22);
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
      const stroke = (f: string) => getComputedStyle(document.querySelector(`tr[data-fund="${f}"] .spark-line`)!).stroke;
      return { up: probe('var(--spark-up)'), down: probe('var(--spark-down)'), muted: probe('var(--muted)'), us500: stroke('us500'), infl: stroke('euroinfl') };
    });
    expect(strokes.us500).toBe(strokes.up);
    expect(strokes.infl).toBe(strokes.down);
    expect(strokes.us500).toBe(strokes.muted); // Glance's sparklines are neutral

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

    // Aim at the third point (2026-10-27): its x in the SVG's units, scaled to the screen (on screen: the phone's chart starts below the fold).
    await svg.scrollIntoViewIfNeeded();
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

  test('puts each date at its place in calendar time, and draws a flat series without NaN', async ({ page }) => {
    await open(page);
    // Dates 2026-09-01 … 2026-11-03: a gap of 30 days then 33 days, so x is by day, not by index (63 days in all).
    const xs = await page.locator('svg.chart .chart-line').evaluate((el) =>
      el.getAttribute('d')!.split(/[ML]/).filter(Boolean).map((p) => Number(p.trim().split(' ')[0])),
    );
    const days = [0, 30, 56, 57, 58, 59, 62, 63]; // 09-01, 10-01, 10-27, 10-28, 10-29, 10-30, 11-02, 11-03
    expect(xs).toHaveLength(days.length);
    days.forEach((d, i) => expect(xs[i]!).toBeCloseTo(xs[0]! + (d / 63) * (xs.at(-1)! - xs[0]!), 0));

    // Every NAV constant: the index is 100 throughout; the scale must still have 3 to 5 labelled lines.
    await page.unroute('**/data/prices.json');
    await open(page, (text) => {
      const s = JSON.parse(text) as { funds: Record<string, { bars: [string, number][] }> };
      for (const f of Object.values(s.funds)) f.bars = f.bars.map(([d]) => [d, f.bars[0]![1]]);
      return JSON.stringify(s);
    });
    const svg = page.locator('svg.chart');
    await expect(svg.locator('.chart-end')).toHaveText('100.00');
    const markup = await svg.evaluate((el) => el.outerHTML);
    expect(markup).not.toMatch(/NaN|Infinity/);
    const yLabels = await svg.locator('.chart-y text').allTextContents();
    expect(yLabels.length).toBeGreaterThanOrEqual(3);
    expect(yLabels.length).toBeLessThanOrEqual(5);
    expect(yLabels).toContain('100.00');
    await expect(page.locator('tbody .sparkline')).toHaveCount(8);
  });

  test('redraws at a new width and keeps the readout on the same date', async ({ page }) => {
    await open(page);
    const svg = page.locator('svg.chart');
    await svg.focus();
    await page.keyboard.press('ArrowLeft'); // 2026-11-02
    const readout = page.locator('.chart-readout');
    await expect(readout).toHaveText('109.40 on 2026-11-02');
    const before = Number(await svg.getAttribute('width'));
    await page.setViewportSize({ width: before > 500 ? 360 : 1280, height: 800 });
    await expect.poll(async () => Number(await svg.getAttribute('width'))).not.toBe(before);
    const sizes = await svg.evaluate((el: SVGSVGElement) => ({ svg: el.getBoundingClientRect().width, section: ((sec: HTMLElement) => sec.getBoundingClientRect().width - parseFloat(getComputedStyle(sec).paddingLeft) - parseFloat(getComputedStyle(sec).paddingRight) - 2 * parseFloat(getComputedStyle(el.parentElement!).marginLeft))(el.closest('section')!), drawn: el.viewBox.baseVal.width }));
    expect(Math.abs(sizes.svg - sizes.section)).toBeLessThan(1);
    expect(Math.abs(sizes.drawn - sizes.section)).toBeLessThan(1); // drawn at its frame's whole pixels
    await expect(readout).toHaveText('109.40 on 2026-11-02');
    await expect(svg.locator('.chart-dot')).toHaveAttribute('visibility', 'visible');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test('a finger drags along the line, and a vertical swipe on it still scrolls the page', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('phone'), 'touch only');
    await open(page);
    const svg = page.locator('svg.chart');
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    const readout = page.locator('.chart-readout');
    const cdp = await page.context().newCDPSession(page);
    const y = Math.round(box.y + box.height / 2);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, yy = y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: yy }] });
    const scrollY = () => page.evaluate(() => window.scrollY);
    const before = await scrollY();
    await touch('touchStart', box.x + box.width * 0.9);
    await touch('touchMove', box.x + box.width * 0.9 - 5);
    const first = await readout.textContent();
    for (let x = box.x + box.width * 0.9; x >= box.x + box.width * 0.15; x -= 8) await touch('touchMove', x);
    await touch('touchEnd', 0);
    expect(await readout.textContent()).not.toBe(first); // it followed the finger
    await expect(readout).toHaveAttribute('data-state', 'active'); // and stays when the finger lifts
    expect(await scrollY()).toBe(before); // a sideways drag does not scroll the page
    const mid = Math.round(box.x + box.width / 2);
    await touch('touchStart', mid, y);
    for (let d = 0; d <= 120; d += 10) await touch('touchMove', mid, y - d);
    await touch('touchEnd', 0);
    await expect.poll(scrollY).toBeGreaterThan(before + 20);
  });

  test('a snapshot of one date shows "not enough history" instead of a line', async ({ page }) => {
    await open(page, (text) => {
      const s = JSON.parse(text) as { funds: Record<string, { bars: [string, number][] }> };
      for (const f of Object.values(s.funds)) f.bars = f.bars.filter(([d]) => d === '2026-11-03');
      return JSON.stringify(s);
    });
    const region = page.getByRole('region', { name: 'Portfolio value' });
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
  const chart = page.getByRole('region', { name: 'Portfolio value' });
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
      state === 'missing' ? 'No price snapshot yet. Build one with npm run snapshots' : 'The price snapshot could not be read',
    );
    if (state === 'missing') {
      // The three sections and the footer say the same thing.
      await expect(performance.locator('.placeholder')).toHaveText(
        "No price snapshot yet. Build one with npm run snapshots; the portfolio's return over 1d · 5d · 1w · 1m · 2m will show here then.",
      );
      await expect(page.getByRole('region', { name: 'Portfolio value' }).locator('.placeholder')).toHaveText(
        'No price snapshot yet. Build one with npm run snapshots, so there is no line to draw.',
      );
      await expect(page.getByRole('region', { name: 'Positions' }).locator('.section-note')).toHaveText(
        'Tap a fund for its full name. Returns appear once a snapshot is built.',
      );
      await expect(page.locator('footer')).toContainText('Prices: no snapshot yet.');
    }
    for (const name of ['Performance', 'Portfolio value']) {
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
    // Equities at the left, bonds at the right, each word over its figure (Glance; beside it in Desk).
    expect(await allocation.locator('.split-item').allTextContents()).toEqual(['Equities 90.34 %', 'Bonds 9.66 %']);
    const [eq, bd] = await allocation.locator('.split-item').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    expect(eq!.left).toBeLessThan(bd!.left);
    expect(Math.abs(eq!.top - bd!.top)).toBeLessThan(1);
    const word = (await allocation.locator('.split-item').first().locator('.split-word').boundingBox())!;
    const figure = (await allocation.locator('.split-item').first().locator('.split-figure').boundingBox())!;
    expect(figure.y).toBeGreaterThanOrEqual(word.y + word.height - 1);
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

  // As the badge's detail: Escape closes it (focus back on the name), a press inside keeps it, one outside closes it.
  await button.click();
  await expect(longest.locator('.fund-full')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(longest.locator('.fund-full')).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeFocused();
  await button.click();
  await longest.locator('.fund-full').click();
  await expect(longest.locator('.fund-full')).toBeVisible();
  await page.locator('h1').click();
  await expect(longest.locator('.fund-full')).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
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
    expect(forcedBg).toBe(forced === 'dark' ? 'rgb(14, 16, 19)' : 'rgb(242, 242, 238)'); // Glance's --bg, DESIGN.md
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  expect(await bg()).toBe(system);
});

/*
 * The badge's states (SPEC "Freshness states"), against a faked clock in Madrid. L = Tuesday 2026-11-03.
 * FRESH from Wednesday to Thursday (two weekdays back reaches Tuesday), STALE from Friday (it reaches Wednesday).
 */
test.describe('the freshness badge', () => {
  /** The computed colour of a CSS colour expression, and of the badge's state words and dot. */
  async function colours(page: Page) {
    return page.evaluate(() => {
      const probe = (value: string) => {
        const el = document.createElement('span');
        el.style.color = value;
        document.body.append(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      };
      const states = document.querySelector('.badge-states');
      return {
        ok: probe('var(--ok)'),
        warn: probe('var(--warn)'),
        error: probe('var(--error)'),
        states: states ? getComputedStyle(states).color : null,
        dot: getComputedStyle(document.querySelector('.badge-dot')!).backgroundColor,
      };
    });
  }

  for (const [day, now, state] of [
    ['Wednesday', WEDNESDAY, 'FRESH'],
    ['Thursday', '2026-11-05T11:00:00Z', 'FRESH'],
    ['Friday', '2026-11-06T11:00:00Z', 'STALE'],
  ] as const) {
    test(`on ${day} the fixture's NAV of Tuesday is ${state}, and the numbers still show`, async ({ page }, testInfo) => {
      await open(page, WITHOUT_DROPPED, now);
      const badge = page.locator('.badge');
      await expect(badge).toHaveText(`NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · ${state}`);
      await expect(badge).toHaveAttribute('data-tone', state === 'FRESH' ? 'ok' : 'warn');
      const c = await colours(page);
      expect(c.states).toBe(state === 'FRESH' ? c.ok : c.warn);
      expect(c.dot).toBe(c.states);
      // Numbers under STALE as under FRESH.
      await expect(page.locator('.tile[data-window="2m"] .tile-value')).toHaveText('+8.49 %');
      await expect(page.locator('.chart-line')).toBeVisible();
      await expect(page.locator('tr[data-fund="us500"] .ret[data-window="1d"]')).toHaveText('−0.90 %');
      if (process.env.EVIDENCE_DIR) {
        await page.locator('header').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-badge-${state.toLowerCase()}.png`) });
      }
    });
  }

  test('opens its detail on a tap or click: source, snapshot time in UTC and in the viewer’s time', async ({ page }, testInfo) => {
    await open(page, WITHOUT_DROPPED);
    const badge = page.locator('.badge');
    const detail = page.locator('.badge-detail');
    await expect(badge).toHaveAttribute('title', /Source: Yahoo Finance \(unofficial\)/); // the hover tooltip
    await expect(detail).toBeHidden();
    await badge.click();
    await expect(badge).toHaveAttribute('aria-expanded', 'true');
    await expect(detail).toBeVisible();
    await expect(detail.locator('li')).toHaveText([
      'Source: Yahoo Finance (unofficial)',
      'Snapshot built 2026-11-04 06:30 UTC (2026-11-04 07:30 CET your time)',
      'FRESH: the latest NAV is of 2026-11-03; on 2026-11-04, a NAV from 2026-11-02 on is fresh (two weekdays back).',
    ]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (process.env.EVIDENCE_DIR) {
      await page.locator('header').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-badge-open.png`) });
    }
    await badge.press('Enter');
    await expect(detail).toBeHidden();
  });

  test('shows the run’s warning as the detail’s last line, with no change to the badge’s text or colour', async ({ page }, testInfo) => {
    const warning = "Vanguard failed for 1 of 8 funds, so Yahoo's bars alone are used for them: europe: HTTP 404 (404 | Vanguard UK Professional)";
    await open(page, (text) => mutate(WITHOUT_DROPPED(text), (s) => (s.warning = warning)));
    const badge = page.locator('.badge');
    await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
    await expect(badge).toHaveAttribute('data-tone', 'ok');
    await badge.click();
    const detail = page.locator('.badge-detail');
    await expect(detail).toBeVisible();
    await expect(detail.locator('li').last()).toHaveText(`Warning: ${warning}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (process.env.EVIDENCE_DIR) {
      await page.locator('header').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-badge-warning.png`) });
    }
  });

  test('is PARTIAL with a fund missing its latest date, and lists each fund’s', async ({ page }, testInfo) => {
    await open(page, () => LAGGING);
    const badge = page.locator('.badge');
    await expect(badge).toHaveText('NAV as of 2026-11-02 · snapshot 2026-11-04 06:30 UTC · FRESH · PARTIAL');
    await expect(badge).toHaveAttribute('data-tone', 'warn');
    await badge.click();
    const detail = page.locator('.badge-detail');
    await expect(detail).toContainText("PARTIAL: the funds' latest NAVs differ, so the portfolio's is held back to 2026-11-02 by the fund that lags.");
    await expect(detail.locator('li', { hasText: 'Japan Stock: ' })).toHaveText('Japan Stock: 2026-11-02 (behind)');
    await expect(detail.locator('li', { hasText: 'US 500: ' })).toHaveText('US 500: 2026-11-03');
    await expect(page.locator('.tile[data-window="1d"] time')).toHaveText('2026-10-30'); // the numbers show, up to L
    // The fund that lags is marked in its row with the date it reaches, and no other fund is.
    await expect(page.locator('.lag-chip')).toHaveCount(1);
    await expect(page.locator('tr[data-fund="japan"] .lag-chip')).toHaveText('NAV to 2026-11-02');
    await expect(page.locator('tr[data-fund="japan"] .lag-chip')).toBeVisible();
    if (process.env.EVIDENCE_DIR) {
      await page.locator('tr[data-fund="japan"]').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-lagging-row.png`) });
    }
    if (process.env.EVIDENCE_DIR) {
      await page.locator('header').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-badge-partial.png`) });
    }
  });

  test('is PARTIAL on the fixture as it is, naming the date the series dropped', async ({ page }) => {
    await open(page);
    await expect(page.locator('.lag-chip')).toHaveCount(0); // every fund reaches L: no fund is marked
    await page.locator('.badge').click();
    await expect(page.locator('.badge-detail')).toContainText("PARTIAL: 2026-10-26 is missing for some funds, so the portfolio's line and returns skip it.");
  });

  // A failed rebuild writes back the previous file: its L can still be FRESH, so the badge says the run failed itself.
  for (const run of ['failed', 'partial'] as const) {
    test(`says the snapshot run was ${run} on the badge, in the warn colour, and its error in the detail`, async ({ page }, testInfo) => {
      const error = run === 'failed' ? 'every fund failed: us500: HTTP 429' : '1 of 8 funds kept from the previous snapshot: japan: HTTP 429';
      await open(page, (t) => WITHOUT_DROPPED(mutate(t, (s) => Object.assign(s, { state: run, error }))));
      const badge = page.locator('.badge');
      await expect(badge).toHaveText(`NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH · run ${run}`);
      await expect(badge).toHaveAttribute('data-tone', 'warn');
      const c = await colours(page);
      expect(c.states).toBe(c.warn);
      await badge.click();
      await expect(page.locator('.badge-detail li').last()).toHaveText(
        run === 'failed' ? `The last snapshot run failed, so these are the previous prices: ${error}` : `The snapshot run was ${run}: ${error}`,
      );
      if (process.env.EVIDENCE_DIR) {
        await page.locator('header').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-badge-run-${run}.png`) });
      }
    });
  }

  for (const snapshot of ['http500', 'unreadable'] as const) {
    test(`is ERROR on ${snapshot === 'http500' ? 'an HTTP 500' : 'JSON that does not parse'}, with the reason and an error line in each performance section`, async ({ page }, testInfo) => {
      await open(page, snapshot);
      const badge = page.locator('.badge');
      await expect(badge).toHaveText('Allocation as of 2026-11-04 · prices unreadable · ERROR');
      await expect(badge).toHaveAttribute('data-tone', 'error');
      const c = await colours(page);
      expect(c.states).toBe(c.error);
      await badge.click();
      await expect(page.locator('.badge-detail li').first()).toHaveText(
        snapshot === 'http500' ? 'ERROR: the snapshot answered HTTP 500' : /^ERROR: .*JSON/,
      );
      for (const name of ['Performance', 'Portfolio value']) {
        await expect(page.getByRole('region', { name }).locator('.placeholder')).toContainText('could not be read');
      }
      await expect(page.getByRole('region', { name: 'Positions' }).locator('.section-note')).toContainText('could not be read');
      await expect(page.getByRole('region', { name: 'Allocation' }).getByText('Equities 90.34 %')).toBeVisible();
      await expect(page.locator('footer')).toContainText('Prices: the snapshot could not be read');
      // The table's column heads stay readable with the return and sparkline cells empty (T-010's "2ast"): no two overlap.
      const heads = await page.locator('.positions thead th').evaluateAll((els) =>
        els.map((e) => {
          const range = document.createRange();
          range.selectNodeContents(e);
          // On a phone the head is visually hidden (the rows are cards that label their own cells).
          return { text: e.textContent, r: range.getBoundingClientRect(), shown: e.closest('thead')!.getBoundingClientRect().width > 2 };
        }),
      );
      const overlaps: string[] = [];
      for (const a of heads) for (const b of heads) {
        if (a === b || !a.shown || !b.shown || a.text! >= b.text!) continue;
        if (a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) overlaps.push(`${a.text} / ${b.text}`);
      }
      expect(overlaps, 'overlapping column heads').toEqual([]);
      if (process.env.EVIDENCE_DIR) {
        await page.locator('header').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-badge-error-${snapshot}.png`) });
      }
    });
  }

  test('a fund without bars is ERROR, and the badge still names the snapshot', async ({ page }) => {
    await open(page, (t) => mutate(t, (s) => (s.funds.japan!.bars = [])));
    await page.locator('.badge').click();
    await expect(page.locator('.badge-detail li')).toHaveText([
      'ERROR: fund japan has no bars',
      'Source: Yahoo Finance (unofficial)',
      'Snapshot built 2026-11-04 06:30 UTC (2026-11-04 07:30 CET your time)',
      /^No returns are shown/,
    ]);
    await expect(page.locator('footer')).toContainText('Prices: the snapshot of 2026-11-04 06:30 UTC from Yahoo Finance (unofficial) could not be used');
  });

  for (const [what, change, reason] of [
    ['a generatedAt that is not a time', { generatedAt: 'yesterday' }, 'ERROR: the snapshot\'s generatedAt is not an ISO time: "yesterday"'],
    ['an unknown run state', { state: 'weird' }, 'ERROR: the snapshot\'s state is not ok, partial or failed: "weird"'],
    ['a source without a name', { source: { kind: 'yahoo' } }, 'ERROR: the snapshot does not name its source'],
  ] as const) {
    test(`is ERROR on ${what}, with the reason in the detail`, async ({ page }) => {
      await open(page, (t) => JSON.stringify({ ...JSON.parse(WITHOUT_DROPPED(t)), ...change }));
      const badge = page.locator('.badge');
      await expect(badge).toHaveText('Allocation as of 2026-11-04 · prices unreadable · ERROR');
      await badge.click();
      await expect(page.locator('.badge-detail li').first()).toHaveText(reason);
      await expect(page.locator('.tile')).toHaveCount(0);
    });
  }

  test('its detail closes with Escape, focus staying on the badge, and with a click outside it', async ({ page }) => {
    await open(page, WITHOUT_DROPPED);
    const badge = page.locator('.badge');
    const detail = page.locator('.badge-detail');
    await badge.click();
    await expect(detail).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
    await expect(badge).toHaveAttribute('aria-expanded', 'false');
    await expect(badge).toBeFocused();
    // Open again from the keyboard; a click inside the detail keeps it, one on the heading closes it.
    await page.keyboard.press('Enter');
    await expect(detail).toBeVisible();
    await detail.locator('li').first().click();
    await expect(detail).toBeVisible();
    await page.locator('h1').click();
    await expect(detail).toBeHidden();
    await expect(badge).toHaveAttribute('aria-expanded', 'false');
    // The badge still toggles it.
    await badge.click();
    await expect(detail).toBeVisible();
    await badge.click();
    await expect(detail).toBeHidden();
  });
});

test('the allocation shows before the snapshot answers, and the performance sections say prices are loading', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(WEDNESDAY));
  let release!: () => void;
  const answered = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/data/prices.json', async (route) => {
    await answered;
    await route.fulfill({ status: 200, contentType: 'application/json', body: WITHOUT_DROPPED(FIXTURE) });
  });
  await page.goto('/');
  const badge = page.locator('.badge');
  await expect(badge).toHaveText('Allocation as of 2026-11-04 · loading prices…');
  await expect(badge).toHaveAttribute('data-tone', 'none');
  await expect(page.getByRole('region', { name: 'Allocation' }).getByText('Equities 90.34 %')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(8);
  for (const name of ['Performance', 'Portfolio value']) {
    await expect(page.getByRole('region', { name }).locator('.placeholder')).toHaveText('Loading prices…');
  }
  await expect(page.locator('footer')).toContainText('Prices: loading the snapshot…');
  if (process.env.EVIDENCE_DIR) {
    await page.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-loading.png`), fullPage: true });
  }
  release();
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
  await expect(page.locator('.tile')).toHaveCount(5);
});

test('a snapshot that does not answer in 15 s is ERROR, saying so', async ({ page }) => {
  // install(), not setFixedTime(): the page's timers wait for runFor().
  await page.clock.install({ time: new Date(WEDNESDAY) });
  let held = false;
  await page.route('**/data/prices.json', () => {
    held = true; // never answered
  });
  await page.goto('/');
  const badge = page.locator('.badge');
  await expect(badge).toHaveText('Allocation as of 2026-11-04 · loading prices…');
  await expect.poll(() => held).toBe(true);
  await page.clock.runFor(14_000);
  await expect(badge).toHaveText('Allocation as of 2026-11-04 · loading prices…');
  await page.clock.runFor(2_000);
  await expect(badge).toHaveText('Allocation as of 2026-11-04 · prices unreadable · ERROR');
  await expect(badge).toHaveAttribute('data-tone', 'error');
  await badge.click();
  await expect(page.locator('.badge-detail li').first()).toHaveText('ERROR: the snapshot did not answer in 15 s');
  for (const name of ['Performance', 'Portfolio value']) {
    await expect(page.getByRole('region', { name }).locator('.placeholder')).toContainText('could not be read');
  }
  await expect(page.getByRole('region', { name: 'Positions' }).locator('.section-note')).toContainText('could not be read');
  await expect(page.getByRole('region', { name: 'Allocation' }).getByText('Equities 90.34 %')).toBeVisible();
});

test('a tab shown again fetches the snapshot again and judges it against the clock as it is now', async ({ page }) => {
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/data/prices.json')) requests++;
  });
  await open(page, WITHOUT_DROPPED, '2026-11-05T11:00:00Z'); // Thursday noon in Madrid
  const badge = page.locator('.badge');
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
  expect(requests).toBe(1);

  /** Stub document.visibilityState and fire visibilitychange, as the browser does when the tab is hidden or shown. */
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((state) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);

  // Overnight: the tab is hidden, the clock moves to Friday noon. Hiding it, or focusing the window, fetches nothing.
  await setVisibility('hidden');
  await page.clock.setFixedTime(new Date('2026-11-06T11:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('h1').click();
  expect(requests).toBe(1);
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');

  await setVisibility('visible');
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · STALE');
  await expect(badge).toHaveAttribute('data-tone', 'warn');
  expect(requests).toBe(2);
  await expect(page.locator('.tile[data-window="2m"] .tile-value')).toHaveText('+8.49 %');
});

test('a tab shown again after an ERROR recovers, and shows a snapshot rebuilt meanwhile', async ({ page }) => {
  let answer: 'fail' | 'ok' | 'rebuilt' = 'fail';
  await page.clock.setFixedTime(new Date('2026-11-05T11:00:00Z'));
  await page.route('**/data/prices.json', (route) => {
    if (answer === 'fail') return route.fulfill({ status: 500, body: 'boom' });
    const body = answer === 'rebuilt' ? JSON.stringify({ ...JSON.parse(WITHOUT_DROPPED(FIXTURE)), generatedAt: '2026-11-05T09:00:00Z' }) : WITHOUT_DROPPED(FIXTURE);
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.goto('/');
  const badge = page.locator('.badge');
  await expect(badge).toHaveText('Allocation as of 2026-11-04 · prices unreadable · ERROR');
  const show = () =>
    page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  answer = 'ok';
  await show();
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
  answer = 'rebuilt';
  await show();
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-05 09:00 UTC · FRESH');
  await expect(page.locator('.tile')).toHaveCount(5);
});

test('a snapshot whose body stalls after the headers is also ERROR after 15 s', async ({ page }) => {
  await page.clock.install({ time: new Date(WEDNESDAY) });
  // route.fulfill sends headers and body together, so the stall is a stand-in fetch: headers arrive, the body never does, and it fails only when the page aborts.
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (!String(input).endsWith('data/prices.json')) return real(input, init);
      const signal = init?.signal;
      const body = new ReadableStream({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
  });
  await page.goto('/');
  const badge = page.locator('.badge');
  await expect(badge).toHaveText('Allocation as of 2026-11-04 · loading prices…');
  await page.clock.runFor(16_000);
  await expect(badge).toHaveText('Allocation as of 2026-11-04 · prices unreadable · ERROR');
  await badge.click();
  await expect(page.locator('.badge-detail li').first()).toHaveText('ERROR: the snapshot did not answer in 15 s');
});

test('Escape with no badge detail open leaves focus where it is', async ({ page }) => {
  await open(page);
  const fund = page.locator('button.fund-name').first();
  await fund.focus();
  await page.keyboard.press('Escape');
  await expect(fund).toBeFocused();
  await expect(page.locator('.badge')).toHaveAttribute('aria-expanded', 'false');
});

// The freshness rule at its edges, on the fixture cut off at a date L (every fund ends there). "Two weekdays
// before today", a Saturday or a Sunday counting as the Monday after: derived by hand from the 2026 calendar
// (2026-10-29 Thu, 10-30 Fri, 10-31 Sat, 11-01 Sun, 11-02 Mon, 11-03 Tue).
test.describe('the freshness rule at its edges', () => {
  const upTo = (last: string) => (text: string) =>
    mutate(WITHOUT_DROPPED(text), (s) => {
      for (const fund of Object.values(s.funds)) fund.bars = fund.bars.filter(([d]) => d <= last);
    });

  for (const [last, today, state] of [
    ['2026-10-29', '2026-11-02', 'FRESH'], // Monday, L = the Thursday before
    ['2026-10-28', '2026-11-02', 'STALE'], // Monday, L = the Wednesday
    ['2026-10-29', '2026-10-31', 'FRESH'], // Saturday counts as Monday
    ['2026-10-29', '2026-11-01', 'FRESH'], // Sunday too
    ['2026-10-28', '2026-11-01', 'STALE'],
    ['2026-10-30', '2026-11-03', 'FRESH'], // Tuesday, L = the Friday
    ['2026-10-29', '2026-11-03', 'STALE'],
  ] as const) {
    test(`L ${last}, viewed on ${today}: ${state}`, async ({ page }) => {
      await open(page, upTo(last), `${today}T11:00:00Z`);
      await expect(page.locator('.badge')).toHaveText(new RegExp(`^NAV as of ${last} · snapshot 2026-11-04 06:30 UTC · ${state}$`));
      await expect(page.locator('.badge')).toHaveAttribute('data-tone', state === 'FRESH' ? 'ok' : 'warn');
    });
  }

  test('a date the series dropped before the 2m window is not PARTIAL; a fund a day ahead of the others is', async ({ page }) => {
    await open(page, (text) => mutate(WITHOUT_DROPPED(text), (s) => s.funds.us500!.bars.unshift(['2026-08-31', 90])));
    await expect(page.locator('.badge')).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
    await page.unroute('**/data/prices.json');
    await page.route('**/data/prices.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: mutate(WITHOUT_DROPPED(FIXTURE), (s) => s.funds.us500!.bars.push(['2026-11-04', 111])) }),
    );
    await page.reload();
    const badge = page.locator('.badge');
    await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH · PARTIAL');
    await badge.click();
    await expect(page.locator('.badge-detail li', { hasText: 'US 500: ' })).toHaveText('US 500: 2026-11-04');
    await expect(page.locator('.badge-detail li', { hasText: 'European Stock: ' })).toHaveText('European Stock: 2026-11-03 (behind)');
  });

  test('a source name and an error that look like markup are shown as text', async ({ page }) => {
    await open(page, (text) =>
      JSON.stringify(Object.assign(JSON.parse(WITHOUT_DROPPED(text)), { source: { name: '<img src=x onerror=window.__x=1>', kind: 'yahoo' }, state: 'failed', error: '<b>bold</b>' })),
    );
    await page.locator('.badge').click();
    await expect(page.locator('.badge-detail li').first()).toHaveText('Source: <img src=x onerror=window.__x=1>');
    await expect(page.locator('.badge-detail li').last()).toContainText('<b>bold</b>');
    await expect(page.locator('.badge-detail img, .badge-detail b')).toHaveCount(0);
  });
});

// The same instant is Friday in Madrid and still Thursday evening in New York: the viewer's own date decides.
test.describe('the viewer’s time zone decides the date', () => {
  const LATE = '2026-11-05T23:30:00Z';
  test('Madrid, 00:30 on Friday: the NAV of Tuesday is STALE', async ({ page }) => {
    await open(page, WITHOUT_DROPPED, LATE);
    await expect(page.locator('.badge')).toContainText('STALE');
  });
  test.describe('New York', () => {
    test.use({ timezoneId: 'America/New_York' });
    test('the same instant, 18:30 on Thursday: FRESH, and the snapshot time in New York time', async ({ page }) => {
      await open(page, WITHOUT_DROPPED, LATE);
      await expect(page.locator('.badge')).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
      await page.locator('.badge').click();
      await expect(page.locator('.badge-detail li').nth(1)).toHaveText('Snapshot built 2026-11-04 06:30 UTC (2026-11-04 01:30 GMT-5 your time)');
    });
  });
});

test.describe('the badge on a touch screen and from the keyboard', () => {
  test.use({ hasTouch: true });
  test('a tap opens the detail and a second tap closes it; Space opens it from the keyboard', async ({ page }) => {
    await open(page, WITHOUT_DROPPED);
    const badge = page.locator('.badge');
    await badge.tap();
    await expect(badge).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.badge-detail')).toBeVisible();
    await badge.tap();
    await expect(page.locator('.badge-detail')).toBeHidden();
    await badge.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.badge-detail')).toBeVisible();
  });

  test('a tap outside the detail closes it; a tap inside does not', async ({ page }) => {
    await open(page, WITHOUT_DROPPED);
    const badge = page.locator('.badge');
    const detail = page.locator('.badge-detail');
    await badge.tap();
    await expect(detail).toBeVisible();
    await detail.locator('li').first().tap();
    await expect(detail).toBeVisible();
    await page.locator('h1').tap();
    await expect(detail).toBeHidden();
    await expect(badge).toHaveAttribute('aria-expanded', 'false');
  });
});

// GitHub Pages serves the site at https://<user>.github.io/portfolio-tracker/ (README, "Keeping it current"):
// the build refers to its files relatively (vite base './'), so it works under that sub-path too.
test('the built page refers to its files relatively, and works under a sub-path', async ({ page }) => {
  const dist = path.join(import.meta.dirname, '..', 'dist');
  expect(readFileSync(path.join(dist, 'index.html'), 'utf8')).not.toMatch(/["'(]\/(assets|data)\//);
  await page.route('**/portfolio-tracker/**', (route) => {
    const file = new URL(route.request().url()).pathname.replace(/^\/portfolio-tracker\//, '') || 'index.html';
    if (file === 'data/prices.json') return route.fallback();
    return route.fulfill({ path: path.join(dist, file) });
  });
  const requested: string[] = [];
  page.on('request', (r) => requested.push(new URL(r.url()).pathname));
  await open(page, WITHOUT_DROPPED, WEDNESDAY, '/portfolio-tracker/');
  await expect(page.locator('.badge')).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
  expect(requested).toContain('/portfolio-tracker/data/prices.json');
  expect(requested.filter((p) => !p.startsWith('/portfolio-tracker/')), 'requests outside the sub-path').toEqual([]);
});
