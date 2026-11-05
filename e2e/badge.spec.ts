// The freshness badge (SPEC "Freshness states"): FRESH or STALE by the viewer's date, worked out by hand
// from the 2026 calendar against a faked clock; PARTIAL, the run's state and warning, ERROR with its reason;
// the detail it opens by click, tap and keyboard and closes by Escape and a press outside; the 15 s timeout;
// and a fresh look when the tab is shown again. The snapshot is e2e/fixtures/prices.json, L = Tuesday 2026-11-03.
// ERROR on an HTTP 500 and on JSON that does not parse is page.spec.ts's (the unreadable state).
import { expect, FIXTURE, LAGGING, WEDNESDAY, WITHOUT_DROPPED, mutate, open, overflow, probe, test, evidence } from './helpers';
import type { Page } from '@playwright/test';

/** The computed colour of the badge's state words and of its dot. */
async function stateColours(page: Page): Promise<{ states: string; dot: string }> {
  return {
    states: await page.locator('.badge-states').first().evaluate((e) => getComputedStyle(e).color),
    dot: await page.locator('.badge-dot').evaluate((e) => getComputedStyle(e).backgroundColor),
  };
}

// FRESH from Wednesday to Thursday (two weekdays back reaches Tuesday), STALE from Friday (it reaches Wednesday).
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
    const c = await stateColours(page);
    expect(c.states).toBe(await probe(page, state === 'FRESH' ? 'var(--ok)' : 'var(--warn)'));
    expect(c.dot).toBe(c.states);
    // Numbers under STALE as under FRESH.
    await expect(page.locator('.tile[data-window="2m"] .tile-value')).toHaveText('+8.49 %');
    await expect(page.locator('.chart-line')).toBeVisible();
    await expect(page.locator('tr[data-fund="us500"] .ret[data-window="1d"]')).toHaveText('−0.90 %');
    await evidence(page.locator('header'), testInfo.project.name, `badge-${state.toLowerCase()}`);
  });
}

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

test('is PARTIAL with a fund missing its latest date, listing each fund’s, and on a date the series dropped, naming it', async ({ page }, testInfo) => {
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
  await evidence(page.locator('header'), testInfo.project.name, 'badge-partial');

  // The fixture as it is: us500 alone has 2026-10-26, which the series drops inside the 2m window.
  await page.unroute('**/data/prices.json');
  await open(page);
  await page.locator('.badge').click();
  await expect(page.locator('.badge-detail')).toContainText("PARTIAL: 2026-10-26 is missing for some funds, so the portfolio's line and returns skip it.");
});

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

// A failed rebuild writes back the previous file: its L can still be FRESH, so the badge says the run failed itself.
for (const run of ['failed', 'partial'] as const) {
  test(`says the snapshot run was ${run} on the badge, in the warn colour, and its error in the detail`, async ({ page }, testInfo) => {
    const error = run === 'failed' ? 'every fund failed: us500: HTTP 429' : '1 of 8 funds kept from the previous snapshot: japan: HTTP 429';
    await open(page, (t) => WITHOUT_DROPPED(mutate(t, (s) => Object.assign(s, { state: run, error }))));
    const badge = page.locator('.badge');
    await expect(badge).toHaveText(`NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH · run ${run}`);
    await expect(badge).toHaveAttribute('data-tone', 'warn');
    expect((await stateColours(page)).states).toBe(await probe(page, 'var(--warn)'));
    await badge.click();
    await expect(page.locator('.badge-detail li').last()).toHaveText(
      run === 'failed' ? `The last snapshot run failed, so these are the previous prices: ${error}` : `The snapshot run was ${run}: ${error}`,
    );
    await evidence(page.locator('header'), testInfo.project.name, `badge-run-${run}`);
  });
}

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
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await evidence(page.locator('header'), testInfo.project.name, 'badge-warning');
});

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

test('a source name and an error that look like markup are shown as text', async ({ page }) => {
  await open(page, (text) =>
    JSON.stringify(Object.assign(JSON.parse(WITHOUT_DROPPED(text)), { source: { name: '<img src=x onerror=window.__x=1>', kind: 'yahoo' }, state: 'failed', error: '<b>bold</b>' })),
  );
  await page.locator('.badge').click();
  await expect(page.locator('.badge-detail li').first()).toHaveText('Source: <img src=x onerror=window.__x=1>');
  await expect(page.locator('.badge-detail li').last()).toContainText('<b>bold</b>');
  await expect(page.locator('.badge-detail img, .badge-detail b')).toHaveCount(0);
});

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
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await evidence(page.locator('header'), testInfo.project.name, 'badge-open');
  await badge.press('Enter');
  await expect(detail).toBeHidden();
});

test('its detail closes with Escape, focus staying on the badge, and with a click outside it; Escape with nothing open moves nothing', async ({ page }) => {
  await open(page, WITHOUT_DROPPED);
  const badge = page.locator('.badge');
  const detail = page.locator('.badge-detail');
  // Nothing open: Escape leaves focus where it is.
  const fund = page.locator('button.fund-name').first();
  await fund.focus();
  await page.keyboard.press('Escape');
  await expect(fund).toBeFocused();
  await expect(badge).toHaveAttribute('aria-expanded', 'false');

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

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });
  test('a tap opens the detail, a tap inside keeps it, a tap outside or on the badge closes it; Space opens it from the keyboard', async ({ page }) => {
    await open(page, WITHOUT_DROPPED);
    const badge = page.locator('.badge');
    const detail = page.locator('.badge-detail');
    await badge.tap();
    await expect(badge).toHaveAttribute('aria-expanded', 'true');
    await expect(detail).toBeVisible();
    await badge.tap();
    await expect(detail).toBeHidden();
    await badge.tap();
    await expect(detail).toBeVisible();
    await detail.locator('li').first().tap();
    await expect(detail).toBeVisible();
    await page.locator('h1').tap();
    await expect(detail).toBeHidden();
    await expect(badge).toHaveAttribute('aria-expanded', 'false');
    await badge.focus();
    await page.keyboard.press('Space');
    await expect(detail).toBeVisible();
  });
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

/** Stub document.visibilityState and fire visibilitychange, as the browser does when the tab is hidden or shown. */
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

test('a tab shown again fetches the snapshot again and judges it against the clock as it is now', async ({ page }) => {
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/data/prices.json')) requests++;
  });
  await open(page, WITHOUT_DROPPED, '2026-11-05T11:00:00Z'); // Thursday noon in Madrid
  const badge = page.locator('.badge');
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
  expect(requests).toBe(1);

  // Overnight: the tab is hidden, the clock moves to Friday noon. Hiding it, or focusing the window, fetches nothing.
  await setVisibility(page, 'hidden');
  await page.clock.setFixedTime(new Date('2026-11-06T11:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('h1').click();
  expect(requests).toBe(1);
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');

  await setVisibility(page, 'visible');
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
  answer = 'ok';
  await setVisibility(page, 'visible');
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-04 06:30 UTC · FRESH');
  answer = 'rebuilt';
  await setVisibility(page, 'visible');
  await expect(badge).toHaveText('NAV as of 2026-11-03 · snapshot 2026-11-05 09:00 UTC · FRESH');
  await expect(page.locator('.tile')).toHaveCount(5);
});
