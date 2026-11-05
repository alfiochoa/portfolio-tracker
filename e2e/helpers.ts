// What every e2e file shares: the test with its guards, the clock and the snapshot fixtures, open().
// Each *.spec.ts imports `test` and `expect` from here, not from @playwright/test.
//
// The page reads only its own files: any request outside the site is aborted, and fails the test after it,
// as does any error thrown on the page. The snapshot is always a fixture (e2e/fixtures/) or a stand-in made
// from one, so the numbers are known. Set EVIDENCE_DIR to also save the screenshots the tests name.
import { expect, test as base, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export { expect };

export const FIXTURE = readFileSync(path.join(import.meta.dirname, 'fixtures', 'prices.json'), 'utf8');
/** The fixture with japan's 2026-11-03 and us500's 2026-10-26 taken out: one fund a day behind, no date dropped. */
export const LAGGING = readFileSync(path.join(import.meta.dirname, 'fixtures', 'prices-lagging.json'), 'utf8');

// The viewer is in Madrid (the `timezoneId` below), and the clock is the page's only one (src/main.ts):
// Wednesday 2026-11-04, noon in Madrid, unless a test says otherwise. The fixture's L is Tuesday 2026-11-03, so it is FRESH then.
export const WEDNESDAY = '2026-11-04T11:00:00Z';

let outside: string[] = [];
let errors: string[] = [];

export const test = base.extend<{ guard: void }>({
  // Every test runs in Madrid; a describe may still `test.use({ timezoneId })` another zone.
  timezoneId: 'Europe/Madrid',
  guard: [
    async ({ page, baseURL }, use) => {
      outside = [];
      errors = [];
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(baseURL!)) return route.continue();
        outside.push(url);
        return route.abort();
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await use();
      expect(outside, 'requests outside the site').toEqual([]);
      expect(errors, 'errors thrown on the page').toEqual([]);
    },
    { auto: true },
  ],
});

export type Snapshot = 'fixture' | 'missing' | 'unreadable' | 'http500' | ((text: string) => string);

/** Open the page at `at` with the clock at `now` and `snapshot` served as data/prices.json, and wait for the snapshot's render. */
export async function open(page: Page, snapshot: Snapshot = 'fixture', now: string = WEDNESDAY, at = '/'): Promise<void> {
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

type Mutable = { warning?: string; funds: Record<string, { bars: [string, number][] }> };
/** The snapshot `text`, parsed, changed in place by `change`, and serialised again. */
export function mutate(text: string, change: (s: Mutable) => unknown): string {
  const s = JSON.parse(text) as Mutable;
  change(s);
  return JSON.stringify(s);
}

/** The fixture with us500's lone 2026-10-26 taken out, so no date is dropped from the series: neither PARTIAL nor any return changes. */
export const WITHOUT_DROPPED = (text: string): string => mutate(text, (s) => (s.funds.us500!.bars = s.funds.us500!.bars.filter(([d]) => d !== '2026-10-26')));

/** Only the bars from 2026-10-27 on: six series dates, so 1d, 5d and 1w have a start, 1m and 2m do not. */
export const SHORT_HISTORY = (text: string): string =>
  mutate(text, (s) => {
    for (const f of Object.values(s.funds)) f.bars = f.bars.filter(([d]) => d >= '2026-10-27');
  });

/** The computed colour of a CSS colour expression (`var(--up)`), on the page as it is. */
export const probe = (page: Page, value: string): Promise<string> =>
  page.evaluate((v) => {
    const el = document.createElement('span');
    el.style.color = v;
    document.body.append(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, value);

/**
 * Every value inside its box's padding: each tile's value inside its tile, each return inside its chip
 * (the text's own box, measured with a Range, so a value that runs past its cell is caught).
 * With `only = '.tile-value'`, the tiles alone.
 */
export async function spills(page: Page, only?: '.tile-value'): Promise<string[]> {
  return page.evaluate((only) => {
    const out: string[] = [];
    const pairs: [Element, Element][] = [
      ...[...document.querySelectorAll('.tile-value')].map((v) => [v, v.closest('.tile')!] as [Element, Element]),
      ...(only ? [] : [...document.querySelectorAll('.positions .chip')].map((c) => [c, c] as [Element, Element])),
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
  }, only);
}

/** How far the page is wider than the screen (0 or less: no sideways scroll). */
export const overflow = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Save a screenshot of `target` (the whole page if it is the page) as EVIDENCE_DIR/<project>-<name>.png, when EVIDENCE_DIR is set. */
export async function evidence(target: Page | ReturnType<Page['locator']>, project: string, name: string): Promise<void> {
  if (!process.env.EVIDENCE_DIR) return;
  const file = path.join(process.env.EVIDENCE_DIR, `${project}-${name}.png`);
  if ('goto' in target) await target.screenshot({ path: file, fullPage: true });
  else await target.screenshot({ path: file });
}
