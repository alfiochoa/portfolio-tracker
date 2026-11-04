// Boot: the allocation is bundled at build time, the price snapshot fetched at runtime; compute, render.
// The page renders at once (allocation and positions, the performance sections saying prices are
// loading) and again when the fetch settles.
import './styles.css';
import funds from '../data/funds.json';
import portfolio from '../data/portfolio.json';
import { assessFreshness, seriesFacts, type Freshness, type PricesOutcome } from './lib/freshness.ts';
import { allocationOf, positionsOf, type Fund, type Portfolio } from './lib/portfolio.ts';
import { readPrices, type Returns } from './lib/returns.ts';
import { parseSnapshot, type Snapshot } from './lib/snapshot.ts';
import { renderAllocation } from './ui/allocation.ts';
import { renderHeader } from './ui/badge.ts';
import { renderChart } from './ui/chart.ts';
import { renderFooter } from './ui/footer.ts';
import { renderPositions } from './ui/positions.ts';
import { renderTiles } from './ui/tiles.ts';
import { h } from './ui/dom.ts';

/** Relative to the page, so the site also works under a sub-path. */
const SNAPSHOT_URL = 'data/prices.json';

/** The one clock (ARCHITECTURE rule 7): freshness is judged against it. The e2e fakes it with Playwright's clock. */
const now = (): Date => new Date();

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app is missing from index.html');

const allocation: Portfolio = portfolio;
const positions = positionsOf(funds as Fund[], allocation);
const fundIds = allocation.positions.map((p) => p.fund);
const names = Object.fromEntries(positions.map((p) => [p.fund.id, p.fund.shortName]));

interface Loaded {
  prices: PricesOutcome;
  returns: Returns | null;
  funds: Snapshot['funds'] | null;
}

/** The snapshot and its returns, or why there are none. Never rejects. */
async function loadPrices(): Promise<Loaded> {
  let text: string | undefined;
  try {
    // no-cache: revalidate, so a snapshot rebuilt today is not served from yesterday's cache.
    const response = await fetch(SNAPSHOT_URL, { cache: 'no-cache' });
    if (response.status === 404) return { prices: { kind: 'missing' }, returns: null, funds: null };
    if (!response.ok) throw new Error(`the snapshot answered HTTP ${response.status}`);
    text = await response.text();
    const { snapshot, returns } = readPrices(allocation, text);
    const facts = seriesFacts(returns, fundIds, snapshot.funds);
    return { prices: { kind: 'loaded', snapshot, facts }, returns, funds: snapshot.funds };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`price snapshot unreadable: ${reason}`);
    // When the file parsed but the returns could not be computed, the badge still names its source and time.
    let snapshot: Snapshot | undefined;
    try {
      if (text !== undefined) snapshot = parseSnapshot(text);
    } catch {
      snapshot = undefined;
    }
    return { prices: { kind: 'unreadable', reason, snapshot }, returns: null, funds: null };
  }
}

function render({ prices, returns, funds }: Loaded): void {
  const freshness: Freshness = assessFreshness({ anchorDate: allocation.anchorDate, prices, now: now(), names });
  const shown = freshness.state === 'loaded' ? returns : null;
  app!.replaceChildren(
    renderHeader(freshness),
    h(
      'main',
      { class: 'sections' },
      renderTiles(freshness, shown),
      renderChart(freshness, shown),
      renderPositions(positions, freshness, shown, shown ? funds : null),
      renderAllocation(allocationOf(positions)),
    ),
    renderFooter(allocation, freshness),
  );
}

render({ prices: { kind: 'loading' }, returns: null, funds: null });
void loadPrices().then(render);
