// Boot: the allocation is bundled at build time, the price snapshot fetched at runtime; compute, render.
import './styles.css';
import funds from '../data/funds.json';
import portfolio from '../data/portfolio.json';
import { loaded, noSnapshot, unreadable, type Freshness } from './lib/freshness.ts';
import { allocationOf, positionsOf, type Fund, type Portfolio } from './lib/portfolio.ts';
import { readPrices, type Returns } from './lib/returns.ts';
import { renderAllocation } from './ui/allocation.ts';
import { renderHeader } from './ui/badge.ts';
import { renderChart } from './ui/chart.ts';
import { renderFooter } from './ui/footer.ts';
import { renderPositions } from './ui/positions.ts';
import { renderTiles } from './ui/tiles.ts';
import { h } from './ui/dom.ts';

/** Relative to the page, so the site also works under a sub-path. */
const SNAPSHOT_URL = 'data/prices.json';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app is missing from index.html');

const allocation: Portfolio = portfolio;
const positions = positionsOf(funds as Fund[], allocation);

/** The snapshot and its returns, or why there are none. Never rejects. */
async function loadPrices(): Promise<{ freshness: Freshness; returns: Returns | null }> {
  const anchor = allocation.anchorDate;
  try {
    // no-cache: revalidate, so a snapshot rebuilt today is not served from yesterday's cache.
    const response = await fetch(SNAPSHOT_URL, { cache: 'no-cache' });
    if (response.status === 404) return { freshness: noSnapshot(anchor), returns: null };
    if (!response.ok) throw new Error(`the snapshot answered HTTP ${response.status}`);
    const { snapshot, returns } = readPrices(allocation, await response.text());
    return { freshness: loaded(anchor, returns.latest, snapshot.generatedAt, snapshot.source?.name ?? ''), returns };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`price snapshot unreadable: ${reason}`);
    return { freshness: unreadable(anchor, reason), returns: null };
  }
}

function render(freshness: Freshness, returns: Returns | null): void {
  app!.replaceChildren(
    renderHeader(freshness),
    h(
      'main',
      { class: 'sections' },
      renderTiles(freshness, returns),
      renderChart(freshness),
      renderPositions(positions, freshness, returns),
      renderAllocation(allocationOf(positions)),
    ),
    renderFooter(allocation),
  );
}

void loadPrices().then(({ freshness, returns }) => render(freshness, returns));
