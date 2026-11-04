// The built site renders every section in its M0 state, at each size and theme (playwright.config.ts projects).
// Set EVIDENCE_DIR to also save a full-page screenshot per project.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const SECTIONS = ['Performance', 'Portfolio value, last two months', 'Positions', 'Allocation'];

// The page reads only its own files: anything else is aborted, and fails the test after it.
let outside: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  outside = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(baseURL!)) return route.continue();
    outside.push(url);
    return route.abort();
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#app > *').first()).toBeVisible();
  expect(errors, 'errors thrown on the page').toEqual([]);
});

test.afterEach(() => {
  expect(outside, 'requests outside the site').toEqual([]);
});

test('the page shows the allocation and says prices are not wired yet', async ({ page }, testInfo) => {
  await expect(page.locator('.badge')).toHaveText('Allocation as of 2026-11-04 · no prices yet');
  await expect(page.getByText('Funds price once a day; the NAV of a day is published the next working day.')).toBeVisible();

  // The sections the spec lists, in order.
  const titles = await page.locator('main h2').allTextContents();
  expect(titles).toEqual(SECTIONS);
  for (const name of SECTIONS) await expect(page.getByRole('region', { name })).toBeVisible();
  await expect(page.locator('footer')).toContainText('Not investment advice');

  // Performance and chart: a quiet placeholder, no number.
  for (const name of ['Performance', 'Portfolio value, last two months']) {
    const region = page.getByRole('region', { name });
    await expect(region.locator('.placeholder')).toContainText('Prices are not wired yet');
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
  await expect(allocation.locator('.class-row')).toHaveCount(8);

  // Nothing wider than the screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  if (process.env.EVIDENCE_DIR) {
    await page.screenshot({ path: path.join(process.env.EVIDENCE_DIR, `${testInfo.project.name}.png`), fullPage: true });
  }
});

test('a fund shows its full name on hover and on tap', async ({ page }, testInfo) => {
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
