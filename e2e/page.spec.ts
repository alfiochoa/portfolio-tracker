// The page itself (SPEC "The page"): its four sections in order, what they show while the snapshot loads,
// when there is none and when it cannot be read; the positions (the funds, their weights from
// data/portfolio.json, a fund's full name, the fund that lags) and the allocation; the theme override.
// The returns in those sections are returns.spec.ts's, the chart chart.spec.ts's, the badge badge.spec.ts's.
import { expect, FIXTURE, LAGGING, WEDNESDAY, WITHOUT_DROPPED, open, overflow, probe, test, evidence } from './helpers';

const SECTIONS = ['Performance', 'Portfolio value', 'Positions', 'Allocation'];

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
  await evidence(page, testInfo.project.name, 'loading');
  release();
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
  await expect(page.locator('.tile')).toHaveCount(5);
});

test('with no snapshot yet, the page shows its sections, the positions and the allocation, and no return', async ({ page }, testInfo) => {
  await open(page, 'missing');
  await expect(page.locator('.badge')).toHaveText('Allocation as of 2026-11-04 · no prices yet');
  await expect(page.getByText('Funds price once a day; the NAV of a day is published the next working day.')).toBeVisible();
  // The sections the spec lists, in order.
  expect(await page.locator('main h2').allTextContents()).toEqual(SECTIONS);
  for (const name of SECTIONS) await expect(page.getByRole('region', { name })).toBeVisible();
  await expect(page.locator('footer')).toContainText('Not investment advice');
  await expect(page.locator('svg')).toHaveCount(0); // no chart, no sparkline
  // The three sections and the footer say the same thing; Performance and the chart a quiet placeholder, no number.
  const performance = page.getByRole('region', { name: 'Performance' });
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
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await evidence(page, testInfo.project.name, 'missing');
});

// The sections as they are with no snapshot (above) are the same with one that cannot be read; here, what differs:
// the badge is ERROR with its reason, every section says the snapshot could not be read, and no number shows.
for (const snapshot of ['http500', 'unreadable'] as const) {
  test(`with ${snapshot === 'http500' ? 'an HTTP 500' : 'JSON that does not parse'} for a snapshot, the badge is ERROR with the reason, each section says so, and no return shows`, async ({ page }, testInfo) => {
    await open(page, snapshot);
    const badge = page.locator('.badge');
    await expect(badge).toHaveText('Allocation as of 2026-11-04 · prices unreadable · ERROR');
    await expect(badge).toHaveAttribute('data-tone', 'error');
    expect(await page.locator('.badge-states').first().evaluate((e) => getComputedStyle(e).color)).toBe(await probe(page, 'var(--error)'));
    await expect(page.locator('svg')).toHaveCount(0); // no chart, no sparkline
    const performance = page.getByRole('region', { name: 'Performance' });
    await expect(performance.locator('.placeholder')).toContainText('The price snapshot could not be read');
    await expect(performance.locator('.tile')).toHaveCount(0);
    for (const name of ['Performance', 'Portfolio value']) {
      const region = page.getByRole('region', { name });
      await expect(region.locator('.placeholder')).toContainText('could not be read');
      await expect(region).not.toContainText('%');
    }
    const positions = page.getByRole('region', { name: 'Positions' });
    await expect(positions.locator('.section-note')).toContainText('could not be read');
    for (const text of await positions.locator('td.ret').allTextContents()) expect(text).toBe('—');
    await expect(positions.locator('.total .weight')).toHaveText('100.00 %');
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
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (snapshot === 'unreadable') await evidence(page, testInfo.project.name, 'unreadable');

    await badge.click();
    await expect(page.locator('.badge-detail li').first()).toHaveText(snapshot === 'http500' ? 'ERROR: the snapshot answered HTTP 500' : /^ERROR: .*JSON/);
    await evidence(page.locator('header'), testInfo.project.name, `badge-error-${snapshot}`);
  });
}

test('a fund shows its full name on hover, on tap and from the keyboard, and closes as the badge\'s detail does', async ({ page }, testInfo) => {
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
  await evidence(longest, testInfo.project.name, 'full-name');
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

  // From the keyboard.
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(longest.locator('.fund-full')).toBeVisible();
});

test('the fund that lags is marked in its row with the date it reaches, and no other fund is', async ({ page }, testInfo) => {
  await open(page, () => LAGGING);
  await expect(page.locator('.lag-chip')).toHaveCount(1);
  await expect(page.locator('tr[data-fund="japan"] .lag-chip')).toHaveText('NAV to 2026-11-02');
  await expect(page.locator('tr[data-fund="japan"] .lag-chip')).toBeVisible();
  await evidence(page.locator('tr[data-fund="japan"]'), testInfo.project.name, 'lagging-row');

  // The fixture as it is: every fund reaches L (a date dropped from the series is not a lag), so no fund is marked.
  await page.unroute('**/data/prices.json');
  await open(page);
  await expect(page.locator('.lag-chip')).toHaveCount(0);
});

test('a data-theme on <html> overrides the system theme, in either direction', async ({ page }) => {
  await open(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const system = await bg();
  for (const forced of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), forced);
    expect(await bg()).toBe(forced === 'dark' ? 'rgb(14, 16, 19)' : 'rgb(242, 242, 238)'); // Glance's --bg, DESIGN.md
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  expect(await bg()).toBe(system);
});
