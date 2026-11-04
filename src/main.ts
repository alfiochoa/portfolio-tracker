// Boot: read the data, compute, render. M0 has no price snapshot; the allocation is bundled at build time.
import './styles.css';
import funds from '../data/funds.json';
import portfolio from '../data/portfolio.json';
import { noSnapshot } from './lib/freshness.ts';
import { allocationOf, positionsOf, type Fund, type Portfolio } from './lib/portfolio.ts';
import { renderAllocation } from './ui/allocation.ts';
import { renderHeader } from './ui/badge.ts';
import { renderChart } from './ui/chart.ts';
import { renderFooter } from './ui/footer.ts';
import { renderPositions } from './ui/positions.ts';
import { renderTiles } from './ui/tiles.ts';
import { h } from './ui/dom.ts';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app is missing from index.html');

const allocation: Portfolio = portfolio;
const positions = positionsOf(funds as Fund[], allocation);
const freshness = noSnapshot(allocation.anchorDate);

app.replaceChildren(
  renderHeader(freshness),
  h(
    'main',
    { class: 'sections' },
    renderTiles(freshness),
    renderChart(freshness),
    renderPositions(positions, freshness),
    renderAllocation(allocationOf(positions)),
  ),
  renderFooter(allocation),
);
