// The deployed build: GitHub Pages serves the site at https://<user>.github.io/portfolio-tracker/ (README,
// "Keeping it current"). The build refers to its files relatively (vite base './'), checked against dist/
// itself and by serving dist/ under that sub-path.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, WEDNESDAY, WITHOUT_DROPPED, open, test } from './helpers';

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
