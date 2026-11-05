// The portfolio value chart (SPEC "Portfolio value") and the positions' sparklines: the SVG drawn from
// e2e/fixtures/prices.json against the index worked out by hand below, the readout by hover, tap and keyboard,
// the x by calendar day, a flat series and a single date, the redraw at a new width, and a finger's drag.
import { expect, open, mutate, probe, test, evidence } from './helpers';

test.use({ hasTouch: true }); // so the phone can tap; the laptop still hovers with a mouse

/*
 * The chart, by hand from the fixture: the 2m window is 2026-09-01 to 2026-11-03, eight series
 * dates (us500's 2026-10-26 is dropped), each V(t)/V(S) × 100 with V(S) = 0.9217395 (returns.spec.ts has V):
 *   2026-09-01 100.00 · 2026-10-01 108.49 · 2026-10-27 113.05 · 2026-11-02 109.40 · 2026-11-03 108.49
 */
test('draws the 2m index with its labels, each date at its place in calendar time, and the sparklines', async ({ page }, testInfo) => {
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

  // Dates 2026-09-01 … 2026-11-03: a gap of 30 days then 33 days, so x is by day, not by index (63 days in all).
  const xs = await line.evaluate((el) => el.getAttribute('d')!.split(/[ML]/).filter(Boolean).map((p) => Number(p.trim().split(' ')[0])));
  const days = [0, 30, 56, 57, 58, 59, 62, 63]; // 09-01, 10-01, 10-27, 10-28, 10-29, 10-30, 11-02, 11-03
  expect(xs).toHaveLength(days.length);
  days.forEach((d, i) => expect(xs[i]!).toBeCloseTo(xs[0]! + (d / 63) * (xs.at(-1)! - xs[0]!), 0));

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

  // A sparkline per fund, 80 × 24 (60 × 22 below 64rem), labelled by its 2m return; neutral in Glance, coloured by it in Desk (views.spec.ts).
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
  const stroke = (f: string) => positions.locator(`tr[data-fund="${f}"] .spark-line`).evaluate((e) => getComputedStyle(e).stroke);
  expect(await stroke('us500')).toBe(await probe(page, 'var(--spark-up)'));
  expect(await stroke('euroinfl')).toBe(await probe(page, 'var(--spark-down)'));

  await evidence(region, testInfo.project.name, 'chart');
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
  await evidence(page.locator('#chart'), testInfo.project.name, 'readout');

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

test('a flat series draws without NaN, and a snapshot of one date shows "not enough history" instead of a line', async ({ page }) => {
  // Every NAV constant: the index is 100 throughout; the scale must still have 3 to 5 labelled lines.
  await open(page, (text) =>
    mutate(text, (s) => {
      for (const f of Object.values(s.funds)) f.bars = f.bars.map(([d]) => [d, f.bars[0]![1]]);
    }),
  );
  const region = page.getByRole('region', { name: 'Portfolio value' });
  const svg = page.locator('svg.chart');
  await expect(svg.locator('.chart-end')).toHaveText('100.00');
  expect(await svg.evaluate((el) => el.outerHTML)).not.toMatch(/NaN|Infinity/);
  const yLabels = await svg.locator('.chart-y text').allTextContents();
  expect(yLabels.length).toBeGreaterThanOrEqual(3);
  expect(yLabels.length).toBeLessThanOrEqual(5);
  expect(yLabels).toContain('100.00');
  await expect(page.locator('tbody .sparkline')).toHaveCount(8);

  // One date only: no line, no sparkline.
  await page.unroute('**/data/prices.json');
  await open(page, (text) =>
    mutate(text, (s) => {
      for (const f of Object.values(s.funds)) f.bars = f.bars.filter(([d]) => d === '2026-11-03');
    }),
  );
  await expect(region.locator('.placeholder')).toHaveText(/^Not enough history/);
  await expect(region.locator('svg')).toHaveCount(0);
  await expect(page.locator('tbody .sparkline')).toHaveCount(0);
});
