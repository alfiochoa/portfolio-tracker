// The view control (docs/DESIGN.md "Views"): Glance by default, Desk one press away, remembered in
// localStorage['portfolio-tracker.view'] and applied before the first paint; and what each view does
// differently (the performance tiles, the positions, the fonts), at each size and theme, on e2e/fixtures/prices.json.
// That every value fits its tile or chip and nothing overflows is checked here, in each view.
// Set EVIDENCE_DIR to also save one full-page screenshot per view per project.
import path from 'node:path';
import { expect, SHORT_HISTORY, open as openSnapshot, probe, spills, test, type Snapshot } from './helpers';
import type { Page } from '@playwright/test';

const KEY = 'portfolio-tracker.view';

let fonts: string[] = [];

test.beforeEach(({ page }) => {
  fonts = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.woff2')) fonts.push(path.basename(new URL(r.url()).pathname));
  });
});

/** Open the page with `view` stored (or nothing stored), and wait for the snapshot's render. */
async function open(page: Page, view?: string, snapshot: Snapshot = 'fixture'): Promise<void> {
  if (view !== undefined) await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [KEY, view]);
  await openSnapshot(page, snapshot);
}

const viewAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-view'));
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);

test('Glance is the default; the control switches to Desk and back, and the choice is remembered', async ({ page }, testInfo) => {
  await open(page);
  const control = page.getByRole('group', { name: 'View' });
  const glance = control.getByRole('button', { name: 'Glance' });
  const desk = control.getByRole('button', { name: 'Desk' });
  expect(await viewAttr(page)).toBeNull();
  await expect(glance).toHaveAttribute('aria-pressed', 'true');
  await expect(desk).toHaveAttribute('aria-pressed', 'false');
  // Every target at least 44 × 44.
  for (const b of [glance, desk]) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // Glance's look: Manrope, tinted cells, the 1d return as the big number.
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^Manrope/);
  await expect(page.locator('.tile-hero')).toHaveAttribute('data-window', '1d');
  if (process.env.EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-glance.png`), fullPage: true });

  const scroll = await page.evaluate(() => {
    window.scrollTo(0, 200);
    return window.scrollY;
  });
  await desk.evaluate((b: HTMLElement) => {
    b.focus({ preventScroll: true });
    b.click(); // a click without Playwright's scroll into view, to see that the page itself moves nothing
  });
  expect(await viewAttr(page)).toBe('desk');
  await expect(desk).toHaveAttribute('aria-pressed', 'true');
  await expect(glance).toHaveAttribute('aria-pressed', 'false');
  expect(await stored(page)).toBe('desk');
  await expect(desk).toBeFocused(); // nothing moves: focus and scroll stay
  // The page does not jump: the browser's scroll anchoring may shift it by the few pixels Desk's shorter header saves.
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scroll)).toBeLessThanOrEqual(24);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"IBM Plex Sans"/);
  // The chosen segment ignores a click.
  await desk.click();
  expect(await viewAttr(page)).toBe('desk');

  // A reload comes back in Desk, the control saying so.
  await page.reload();
  await expect(page.locator('.badge')).not.toHaveAttribute('data-state', 'loading');
  expect(await viewAttr(page)).toBe('desk');
  await expect(page.getByRole('button', { name: 'Desk' })).toHaveAttribute('aria-pressed', 'true');
  if (process.env.EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-desk.png`), fullPage: true });

  await page.getByRole('button', { name: 'Glance' }).click();
  expect(await viewAttr(page)).toBeNull();
  expect(await stored(page)).toBe('glance');
});

test('the stored view is applied before any script of the app runs, so Desk never flashes Glance', async ({ page }, testInfo) => {
  // With the app's module blocked, only index.html's first-paint script can set the attribute.
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.addInitScript(([k]) => localStorage.setItem(k!, 'desk'), [KEY]);
  await page.goto('/');
  expect(await viewAttr(page)).toBe('desk');
  // Desk's page background (DESIGN.md: #e9edf2 light, #0b0e13 dark), not Glance's.
  const dark = testInfo.project.name.endsWith('dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(dark ? 'rgb(11, 14, 19)' : 'rgb(233, 237, 242)');
});

test('an unknown stored value is Glance, and storage that throws is ignored', async ({ page }) => {
  await open(page, 'weird');
  expect(await viewAttr(page)).toBeNull();
  await expect(page.getByRole('button', { name: 'Glance' })).toHaveAttribute('aria-pressed', 'true');

  // A browser that refuses storage: the page still loads in Glance, and the control still switches.
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('storage refused');
    };
    Storage.prototype.setItem = () => {
      throw new Error('storage refused');
    };
  });
  await page.reload();
  await expect(page.locator('.badge')).not.toHaveAttribute('data-state', 'loading');
  expect(await viewAttr(page)).toBeNull();
  await page.getByRole('button', { name: 'Desk' }).click();
  expect(await viewAttr(page)).toBe('desk');
});

test('the control works from the keyboard', async ({ page }) => {
  await open(page);
  const glance = page.getByRole('button', { name: 'Glance' });
  const desk = page.getByRole('button', { name: 'Desk' });
  await glance.focus();
  await page.keyboard.press('Tab');
  await expect(desk).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await viewAttr(page)).toBe('desk');
  await expect(desk).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(glance).toBeFocused();
  await page.keyboard.press('Space');
  expect(await viewAttr(page)).toBeNull();
  await expect(glance).toHaveAttribute('aria-pressed', 'true');
});

test('each view loads only its own fonts, from the site', async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((f) => f.startsWith('manrope')), fonts.join(', ')).toBe(true);
  fonts = [];
  await page.getByRole('button', { name: 'Desk' }).click();
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => fonts.length).toBeGreaterThan(0);
  expect(fonts.every((f) => f.startsWith('ibm-plex')), fonts.join(', ')).toBe(true);
});

for (const view of ['glance', 'desk'] as const) {
  test(`${view}: the tiles and the positions take the view's layout, and every value fits its cell`, async ({ page }, testInfo) => {
    await open(page, view);
    const size = testInfo.project.name.split('-')[0]!;
    // Tiles, counted in rows by their bottom edges (Glance aligns the cells to the hero's bottom from 64rem).
    const bottoms = await page.locator('.tile').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)));
    const rows = new Set(bottoms).size;
    // Desk: five in a row, or 1d 5d 1w then 1m 2m on a phone. Glance: the hero alone above the cells (2 × 2 on a phone) below 64rem.
    const expected = view === 'desk' ? { phone: 2, tablet: 1, laptop: 1 } : { phone: 3, tablet: 2, laptop: 1 };
    expect(rows).toBe(expected[size as keyof typeof expected]);

    // Positions: the asset class in its own column only in Desk from 56rem; under the name otherwise.
    const us500 = page.locator('tr[data-fund="us500"]');
    if (view === 'desk' && size === 'laptop') {
      await expect(us500.locator('td.class')).toBeVisible();
      await expect(us500.locator('.fund-class')).toBeHidden();
    } else {
      await expect(us500.locator('td.class')).toBeHidden();
      await expect(us500.locator('.fund-class')).toBeVisible();
    }
    // Glance tints a return cell and keeps its sparklines neutral; Desk has no tint and colours them by sign.
    const chipBg = await us500.locator('.ret[data-window="2m"] .chip').evaluate((e) => getComputedStyle(e).backgroundColor);
    const stroke = await us500.locator('.spark-line').evaluate((e) => getComputedStyle(e).stroke);
    if (view === 'desk') {
      expect(chipBg).toBe('rgba(0, 0, 0, 0)');
      expect(stroke).toBe(await probe(page, 'var(--up)'));
    } else {
      expect(chipBg).not.toBe('rgba(0, 0, 0, 0)');
      expect(stroke).toBe(await probe(page, 'var(--muted)'));
    }

    // Every tile value inside its tile's padding, every return inside its chip, with the real fonts.
    expect(await spills(page), 'values wider than their cell').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}

test('at 360 px every tile value fits its tile in both views with the fallback fonts too', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('phone'), 'the phone is the narrow case');
  await page.route('**/fonts/**', (route) => route.abort()); // system-ui and ui-monospace, as on a machine without the fonts
  for (const view of ['glance', 'desk']) {
    await open(page, view);
    expect(await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').length)).toBe(0);
    expect(await spills(page, '.tile-value'), `${view}: tile values wider than their tile`).toEqual([]);
    if (process.env.EVIDENCE_DIR) {
      await page.locator('#performance').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-${view}-fallback-tiles.png`) });
      await page.locator('#positions').screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}-${view}-fallback-positions.png`) });
    }
  }
});

for (const view of ['glance', 'desk'] as const) {
  test(`${view}: with a short history the "not enough history" cells stay inside their row and the page does not overflow`, async ({ page }) => {
    // Only the bars from 2026-10-27 on: 1m and 2m have no start (verifier, T-007).
    await open(page, view, SHORT_HISTORY);
    const cells = page.locator('tr[data-fund="us500"] .ret[data-window="2m"]');
    await expect(cells).toContainText('not enough history');
    // The text of the 2m cell stays within its row's box (no overlap into the next fund's block).
    const [cell, row] = await Promise.all([
      cells.evaluate((e) => e.getBoundingClientRect().bottom),
      page.locator('tr[data-fund="us500"]').evaluate((e) => e.getBoundingClientRect().bottom),
    ]);
    expect(cell).toBeLessThanOrEqual(row + 0.5);
    expect(await spills(page), 'values wider than their cell').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}
