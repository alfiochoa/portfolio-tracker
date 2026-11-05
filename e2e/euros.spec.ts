// The euro total (SPEC "The euro total", "Euro amounts"; docs/DESIGN.md "Euro total (M2)"): the line
// under the tiles, its form, the amounts in the tiles and the table, checked against amounts worked
// out by hand from e2e/fixtures/prices.json (below); what happens when the total cannot be carried,
// when the page has no returns, when the browser refuses storage, and that the total never leaves it.
// Set EVIDENCE_DIR to also save the tiles and the table with a total, per view and project.
import type { Page } from '@playwright/test';
import { evidence, expect, open, overflow, probe, SHORT_HISTORY, spills, test } from './helpers';

const KEY = 'portfolio-tracker.total';

/*
 * The fixture, by hand (the returns are e2e/returns.spec.ts's): L = 2026-11-03, the anchor T = 2026-11-04
 * is after L, so P_i(T) = P_i(L) and V(L) = 1. With E = Σ equity weights = 0.9033789478903268 and
 * B = Σ bond weights = 0.0966210521096733, V(S) = E·a(S)/110 + B·b(S)/50.
 *
 * 100 000 € typed for L: the portfolio is worth 100 000 €, fund i 100 000 · w_i, and a window's change
 * is 100 000 · (1 − V(S)):
 *   1d  V = 1.0084058  ->    −840.58  ->    −841 €
 *   5d  V = 1.0420289  ->  −4 202.89  ->  −4 203 €   (1w the same)
 *   1m  V = 1          ->       0     ->       0 €
 *   2m  V = 0.9217395  ->  +7 826.05  ->  +7 826 €
 * US 500 (w 0.3983588675690416): worth 39 835.89 -> 39 836 €; over 1d 39 835.89 · (1 − 111/110) = −362.14 -> −362 €.
 * Eurozone Inflation-Linked (w 0.025422678367792155): 2 542.27 -> 2 542 €; over 2m 2 542.27 · (1 − 52/50) = −101.69 -> −102 €.
 * 100 000 € typed for 2026-11-02 instead: worth 100 000 · V(L)/V(2026-11-02) = 100 000 / 1.0084058 = 99 166.43 -> 99 166 €.
 */
const TILES = [
  ['1d', '−841 €', 'down'],
  ['5d', '−4 203 €', 'down'],
  ['1w', '−4 203 €', 'down'],
  ['1m', '0 €', 'flat'],
  ['2m', '+7 826 €', 'up'],
] as const;

/** The page's spelling of an amount written with plain spaces: U+202F between thousands, U+00A0 before €. */
const eur = (s: string): string => s.replace(/(\d) (?=\d)/g, '$1 ').replace(/ €/g, ' €');

/** Store `total` in the page's localStorage before any script runs. */
const store = (page: Page, euros: number, asOf: string) =>
  page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [KEY, JSON.stringify({ euros, asOf })]);

const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const text = (page: Page, selector: string) => page.locator(selector).first().evaluate((e) => e.textContent);

/** The requests the page makes for the snapshot. */
function snapshotRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/data/prices.json')) seen.push(r.url());
  });
  return seen;
}

test('with nothing stored, the line is a link that opens the form; a wrong entry is refused', async ({ page }) => {
  await open(page);
  const performance = page.getByRole('region', { name: 'Performance' });
  const line = performance.locator('.euro');
  // The last thing in the card.
  expect(await performance.evaluate((s) => s.lastElementChild?.classList.contains('euro'))).toBe(true);
  await expect(line).toHaveAttribute('data-state', 'none');
  await expect(line.getByRole('button')).toHaveText(['Show amounts in euros']);
  await expect(page.locator('.tile-eur, .chip-eur, .eur-value')).toHaveCount(0);

  await line.getByRole('button', { name: 'Show amounts in euros' }).click();
  const input = page.getByLabel("Your portfolio's total value today, in whole euros");
  await expect(input).toBeFocused();
  for (const [attr, value] of [
    ['type', 'number'],
    ['min', '1'],
    ['step', '1'],
    ['inputmode', 'numeric'],
  ]) {
    await expect(input).toHaveAttribute(attr!, value!);
  }
  await expect(line).toContainText('Stays in this browser. It is never sent anywhere or saved with the project.');
  // Every control at least 44 px tall.
  for (const b of await line.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  for (const wrong of ['25.5', '0', '-3', '']) {
    await input.fill(wrong);
    await line.getByRole('button', { name: 'Show amounts' }).click();
    await expect(line.locator('.euro-error')).toHaveText('Type a whole number of euros, like 25000.');
    await expect(page.locator('#euro-input')).toHaveAttribute('aria-invalid', 'true');
    expect(await stored(page)).toBeNull();
  }
  await expect(page.locator('.tile-eur')).toHaveCount(0);

  // Cancel: back to the link, nothing stored.
  await line.getByRole('button', { name: 'Cancel' }).click();
  await expect(line.getByRole('button')).toHaveText(['Show amounts in euros']);
  expect(await stored(page)).toBeNull();
});

test('saving stores the total for L and shows the amounts at once, without a fetch', async ({ page }) => {
  const requests = snapshotRequests(page);
  await open(page);
  const before = requests.length;
  await page.getByRole('button', { name: 'Show amounts in euros' }).click();
  await page.locator('#euro-input').fill('100000');
  await page.getByRole('button', { name: 'Show amounts' }).click();

  await expect(page.locator('.euro')).toHaveAttribute('data-state', 'stored');
  expect(JSON.parse((await stored(page))!)).toEqual({ euros: 100000, asOf: '2026-11-03' });
  expect(requests.length).toBe(before);
  expect(await text(page, '.euro-worth')).toBe(`Worth ${eur('100 000 €')} on 2026-11-03, the amount you entered. ChangeForget`);
  await expect(page.locator('.tile[data-window="1d"] .tile-eur')).toHaveText(eur('−841 €'));
});

test('a stored total: the worth line, every tile, every row and the total row, as computed by hand', async ({ page }, testInfo) => {
  await store(page, 100000, '2026-11-03');
  await open(page);
  const performance = page.getByRole('region', { name: 'Performance' });
  for (const [window, amount, sign] of TILES) {
    const tile = performance.locator(`.tile[data-window="${window}"]`);
    expect(await tile.locator('.tile-eur').evaluate((e) => e.textContent)).toBe(eur(amount));
    await expect(tile).toHaveAttribute('data-sign', sign);
    // The amount takes the percentage's colour.
    const colour = (sel: string) => tile.locator(sel).evaluate((e) => getComputedStyle(e).color);
    expect(await colour('.tile-eur')).toBe(await colour('.tile-value'));
  }
  const [up, down, muted] = [await probe(page, 'var(--up)'), await probe(page, 'var(--down)'), await probe(page, 'var(--muted)')];
  const amountColour = (w: string) => performance.locator(`.tile[data-window="${w}"] .tile-eur`).evaluate((e) => getComputedStyle(e).color);
  expect(await amountColour('1d')).toBe(down);
  expect(await amountColour('2m')).toBe(up);
  expect(await amountColour('1m')).toBe(muted);

  const positions = page.getByRole('region', { name: 'Positions' });
  expect(await text(page, 'tr[data-fund="us500"] .eur-value')).toBe(eur('39 836 €'));
  expect(await text(page, 'tr[data-fund="us500"] .ret[data-window="1d"] .chip-eur')).toBe(eur('−362 €'));
  expect(await text(page, 'tr[data-fund="euroinfl"] .eur-value')).toBe(eur('2 542 €'));
  expect(await text(page, 'tr[data-fund="euroinfl"] .ret[data-window="2m"] .chip-eur')).toBe(eur('−102 €'));
  // The percentage stays as it was, the amount under it.
  await expect(positions.locator('tr[data-fund="us500"] .ret[data-window="1d"]')).toHaveText(`−0.90 %${eur('−362 €')}`);
  expect(await text(page, '.total .eur-value')).toBe(eur('100 000 €'));
  expect(await positions.locator('.total .chip-eur').evaluateAll((es) => es.map((e) => e.textContent))).toEqual(TILES.map(([, a]) => eur(a)));
  // Eight fund values and five changes per fund, no more.
  await expect(positions.locator('tbody .eur-value')).toHaveCount(8);
  await expect(positions.locator('tbody .chip-eur')).toHaveCount(40);
  // The chart, the sparklines and the allocation stay in percentages.
  for (const id of ['chart', 'allocation']) expect(await page.locator(`#${id}`).textContent()).not.toContain('€');

  expect(await spills(page)).toEqual([]);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await evidence(performance, testInfo.project.name, 'glance-performance');
  await evidence(positions, testInfo.project.name, 'glance-positions');
  await page.getByRole('button', { name: 'Desk' }).click();
  expect(await spills(page)).toEqual([]);
  await evidence(performance, testInfo.project.name, 'desk-performance');
  await evidence(positions, testInfo.project.name, 'desk-positions');
});

test('a total from an earlier date follows the prices; Change reopens the form with it, Forget removes it', async ({ page }) => {
  await store(page, 100000, '2026-11-02');
  await open(page);
  const line = page.locator('.euro');
  expect(await text(page, '.euro-worth')).toBe(
    `Worth ${eur('99 166 €')} on 2026-11-03, from the ${eur('100 000 €')} you entered for 2026-11-02; assumes nothing added or withdrawn since. ChangeForget`,
  );
  expect(await text(page, '.total .eur-value')).toBe(eur('99 166 €'));

  await line.getByRole('button', { name: 'Change' }).click();
  await expect(page.locator('#euro-input')).toHaveValue('100000');
  await expect(page.locator('#euro-input')).toBeFocused();
  await line.getByRole('button', { name: 'Cancel' }).click();
  expect(JSON.parse((await stored(page))!)).toEqual({ euros: 100000, asOf: '2026-11-02' });

  await line.getByRole('button', { name: 'Forget' }).click();
  expect(await stored(page)).toBeNull();
  await expect(line.getByRole('button')).toHaveText(['Show amounts in euros']);
  await expect(page.locator('.tile-eur, .chip-eur, .eur-value')).toHaveCount(0);
});

test('a total whose date is no longer in the price history shows no amount and asks for it again', async ({ page }, testInfo) => {
  await store(page, 25000, '2026-05-02');
  await open(page);
  const line = page.locator('.euro');
  await expect(line).toHaveAttribute('data-state', 'not-carried');
  expect(await text(page, '.euro-warn')).toBe(
    `The ${eur('25 000 €')} you entered for 2026-05-02 is older than these prices, so no amounts are shown. Type today's total to see them again.`,
  );
  await expect(page.locator('.tile-eur, .chip-eur, .eur-value, .euro-worth')).toHaveCount(0);
  await expect(line.getByRole('button')).toHaveText(['Change', 'Forget']);
  await evidence(page.locator('#performance'), testInfo.project.name, 'not-carried');
  // Typing it again carries it.
  await line.getByRole('button', { name: 'Change' }).click();
  await page.locator('#euro-input').fill('25000');
  await page.getByRole('button', { name: 'Show amounts' }).click();
  expect(JSON.parse((await stored(page))!)).toEqual({ euros: 25000, asOf: '2026-11-03' });
  await expect(page.locator('.tile-eur')).toHaveCount(5);
});

test('a window without enough history has no amount', async ({ page }) => {
  await store(page, 100000, '2026-11-03');
  await open(page, SHORT_HISTORY);
  for (const w of ['1d', '5d', '1w']) await expect(page.locator(`.tile[data-window="${w}"] .tile-eur`)).toHaveCount(1);
  for (const w of ['1m', '2m']) {
    await expect(page.locator(`.tile[data-window="${w}"] .tile-eur`)).toHaveCount(0);
    await expect(page.locator(`.positions .ret[data-window="${w}"] .chip-eur`)).toHaveCount(0);
  }
});

for (const snapshot of ['missing', 'unreadable'] as const) {
  test(`with the snapshot ${snapshot}, the line is not shown and the stored total is left as it is`, async ({ page }) => {
    await store(page, 100000, '2026-11-03');
    await open(page, snapshot);
    await expect(page.locator('.euro, .tile-eur, .chip-eur, .eur-value')).toHaveCount(0);
    expect(JSON.parse((await stored(page))!)).toEqual({ euros: 100000, asOf: '2026-11-03' });
  });
}

test('nothing about the total leaves the browser', async ({ page }) => {
  const requests: { url: string; type: string; body: string }[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), type: r.resourceType(), body: r.postData() ?? '' }));
  await store(page, 100000, '2026-11-02');
  await open(page);
  // Type another total, so the amount typed in the page is checked too.
  await page.getByRole('button', { name: 'Change' }).click();
  await page.locator('#euro-input').fill('87654');
  await page.getByRole('button', { name: 'Show amounts' }).click();
  await expect(page.locator('.euro')).toHaveAttribute('data-state', 'stored');
  // A return to the tab fetches the snapshot again, and still nothing else.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => requests.filter((r) => r.url.includes('/data/prices.json')).length).toBe(2);

  const data = requests.filter((r) => !['document', 'script', 'stylesheet', 'font', 'image'].includes(r.type));
  expect(data.map((r) => new URL(r.url).pathname)).toEqual(['/data/prices.json', '/data/prices.json']);
  for (const r of requests) {
    for (const secret of ['100000', '87654', '99166', '87 654', '87 654']) {
      expect(r.url).not.toContain(secret);
      expect(r.body).not.toContain(secret);
    }
  }
});

test('a browser that refuses storage: no euros, the form says so, no error', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await open(page);
  await expect(page.locator('.tile')).toHaveCount(5);
  await expect(page.locator('.tile-eur, .chip-eur, .eur-value')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show amounts in euros' }).click();
  const line = page.locator('.euro');
  await expect(line).toContainText('This browser is not keeping anything for this page');
  await page.locator('#euro-input').fill('25000');
  await page.getByRole('button', { name: 'Show amounts' }).click();
  await expect(line.locator('.euro-error')).toContainText('This browser is not keeping anything for this page');
  await expect(page.locator('.tile-eur')).toHaveCount(0);
  // The guard checks that nothing was thrown on the page.
});

test('a return to the tab while typing keeps what is typed, and the focus', async ({ page }) => {
  const requests = snapshotRequests(page);
  await open(page);
  await page.getByRole('button', { name: 'Show amounts in euros' }).click();
  const input = page.locator('#euro-input');
  await input.pressSequentially('1234');
  await page.locator('#performance').evaluate((e) => e.setAttribute('data-old', ''));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => requests.length).toBe(2);
  // The page was drawn again (a new section), with the draft and the focus carried over.
  await expect(page.locator('#performance[data-old]')).toHaveCount(0);
  await expect(input).toHaveValue('1234');
  await expect(input).toBeFocused();
  await input.pressSequentially('5');
  await expect(input).toHaveValue('12345');
});

test('a total of 250 000 € fits every tile, row and phone card, in both views', async ({ page }, testInfo) => {
  // DESIGN.md's widest plausible change is −17 500 € (a 250 000 € portfolio, 7 % on the heaviest fund). On this
  // fixture 250 000 € gives five-figure changes: the total's 2m is 250 000 · (1 − 0.9217395) = +19 565.13.
  await store(page, 250000, '2026-11-03');
  await open(page);
  expect(await text(page, '.total .ret[data-window="2m"] .chip-eur')).toBe(eur('+19 565 €'));
  expect(await spills(page)).toEqual([]);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await evidence(page.locator('#positions'), testInfo.project.name, 'big-glance-positions');
  await page.getByRole('button', { name: 'Desk' }).click();
  expect(await spills(page)).toEqual([]);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await evidence(page.locator('#positions'), testInfo.project.name, 'big-desk-positions');
});

for (const value of [
  'not json',
  'null',
  '[]',
  '{"euros":25000}',
  '{"euros":0,"asOf":"2026-11-03"}',
  '{"euros":-4,"asOf":"2026-11-03"}',
  '{"euros":25.5,"asOf":"2026-11-03"}',
  '{"euros":"25000","asOf":"2026-11-03"}',
  '{"euros":25000,"asOf":"tomorrow"}',
]) {
  test(`a stored ${value} is treated as absent and removed`, async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [KEY, value]);
    await open(page);
    await expect(page.locator('.euro')).toHaveAttribute('data-state', 'none');
    await expect(page.locator('.tile-eur, .chip-eur, .eur-value')).toHaveCount(0);
    expect(await stored(page)).toBeNull();
  });
}

test('an amount too large to keep exactly is refused with the message, and nothing is stored', async ({ page }) => {
  await open(page);
  const line = page.locator('.euro');
  await line.getByRole('button', { name: 'Show amounts in euros' }).click();
  await page.getByLabel("Your portfolio's total value today, in whole euros").fill('99999999999999999999');
  await line.getByRole('button', { name: 'Show amounts' }).click();
  await expect(line).toContainText('Type a whole number of euros, like 25000.');
  expect(await stored(page)).toBeNull();
});
