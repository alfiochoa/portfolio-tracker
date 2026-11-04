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

type Snapshot = 'fixture' | 'missing' | 'unreadable' | ((text: string) => string);

async function open(page: Page, snapshot: Snapshot = 'fixture'): Promise<void> {
  await page.route('**/data/prices.json', (route) => {
    if (snapshot === 'missing') return route.fulfill({ status: 404, body: 'Not Found' });
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

  // The chart is T-005's: still its placeholder.
  await expect(page.getByRole('region', { name: 'Portfolio value, last two months' }).locator('.placeholder')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (process.env.EVIDENCE_DIR) {
    await page.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-loaded.png`), fullPage: true });
  }
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
