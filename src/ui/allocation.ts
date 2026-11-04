// Allocation: one bar of equities against bonds, then the weight of each asset class.
// The bar is a thin segmented bar (dataviz: no text inside, a 2px surface gap); the legend under it
// carries the names and the numbers, and each segment repeats them on hover.
import { formatPercent } from '../lib/format.ts';
import type { Allocation, Kind } from '../lib/portfolio.ts';
import { h, section } from './dom.ts';

const KIND_LABEL: Record<Kind, string> = { equity: 'Equities', bond: 'Bonds' };

function share(el: HTMLElement, weight: number): HTMLElement {
  el.style.setProperty('--share', String(weight));
  return el;
}

function legendItem(kind: Kind, weight: number): HTMLElement {
  return h(
    'li',
    { class: 'legend-item', 'data-kind': kind },
    h('span', { class: 'swatch', 'aria-hidden': 'true' }),
    h('span', { class: 'legend-text' }, `${KIND_LABEL[kind]} `, h('span', { class: 'num' }, formatPercent(weight))),
  );
}

export function renderAllocation(a: Allocation): HTMLElement {
  const parts: [Kind, number][] = [
    ['equity', a.equities],
    ['bond', a.bonds],
  ];
  const label = parts.map(([k, w]) => `${KIND_LABEL[k]} ${formatPercent(w)}`).join(', ');
  const bar = h(
    'div',
    { class: 'split-bar', role: 'img', 'aria-label': label },
    ...parts
      .filter(([, w]) => w > 0)
      .map(([k, w]) =>
        share(h('span', { class: 'split-seg', 'data-kind': k, title: `${KIND_LABEL[k]} ${formatPercent(w)}` }), w),
      ),
  );
  const classes = h(
    'ol',
    { class: 'classes', 'aria-label': 'By asset class' },
    ...a.byAssetClass.map((c) =>
      h(
        'li',
        { class: 'class-row', 'data-kind': c.kind, title: c.nameEs },
        h('span', { class: 'swatch', 'aria-hidden': 'true' }),
        h('span', { class: 'class-name' }, c.name),
        h('span', { class: 'num' }, formatPercent(c.weight)),
        h('span', { class: 'class-track', 'aria-hidden': 'true' }, share(h('span', { class: 'class-fill' }), c.weight)),
      ),
    ),
  );
  return section(
    'allocation',
    'Allocation',
    bar,
    h('ul', { class: 'split-legend' }, ...parts.map(([k, w]) => legendItem(k, w))),
    h('h3', { class: 'subsection-title' }, 'By asset class'),
    classes,
  );
}
