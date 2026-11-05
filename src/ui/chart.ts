// The portfolio's value over the last two months, indexed to 100 at the window's start (SPEC
// "Exact definitions"). Inline SVG drawn at its own pixel width, so labels are the same size on a
// phone and a laptop; redrawn when its box resizes. The readout is text above the chart, reached
// by pointer (hover), touch (tap or drag) and keyboard (arrows while the chart is focused).
import { formatIndex, layoutChart, nearestIndex, portfolioIndex, chartStart, type ChartLayout, type IndexPoint } from '../lib/chart.ts';
import type { Freshness } from '../lib/freshness.ts';
import type { Returns } from '../lib/returns.ts';
import { code, errorPlaceholder, h, placeholder, section } from './dom.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An SVG element (the `h` of dom.ts makes HTML elements, which an <svg> does not draw). */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  el.append(...children);
  return el;
}

/** The width to draw at before the chart is on the page and measured. */
const DEFAULT_WIDTH = 640;

/** The chart's height by the page's breakpoints (docs/DESIGN.md "Chart"): 200 px on a phone, 250 from 40rem, 300 from 64rem. */
function heightNow(): number {
  if (typeof matchMedia === 'undefined') return 250;
  if (matchMedia('(min-width: 64rem)').matches) return 300;
  return matchMedia('(min-width: 40.0625rem)').matches ? 250 : 200;
}
const HINT = 'Hover or tap the line to read any date.';

export const NOT_ENOUGH_TO_DRAW = 'Not enough history to draw a line yet: the snapshot has prices for one date only.';

function describe(points: readonly IndexPoint[]): string {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `Portfolio value index, from 100 on ${first.date} to ${formatIndex(last.value)} on ${last.date}.`;
}

function draw(svg: SVGSVGElement, layout: ChartLayout): { dot: SVGCircleElement; cross: SVGLineElement } {
  const { width, height, plot } = layout;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const grid = s(
    'g',
    { class: 'chart-grid' },
    ...layout.gridlines.filter((g) => g.value !== 100).map((g) => s('line', { x1: plot.x0, x2: plot.x1, y1: g.y, y2: g.y })),
  );
  const yLabels = s(
    'g',
    { class: 'chart-label chart-y', 'text-anchor': 'end' },
    ...layout.gridlines.map((g) => s('text', { x: plot.x0 - 6, y: g.y, 'dominant-baseline': 'middle' }, g.label)),
  );
  const axis = s(
    'g',
    { class: 'chart-axis' },
    s('line', { x1: plot.x0, x2: plot.x1, y1: plot.y1, y2: plot.y1 }),
    ...layout.monthTicks.map((x) => s('line', { x1: x, x2: x, y1: plot.y1, y2: plot.y1 + 5 })),
  );
  const xLabels = s(
    'g',
    { class: 'chart-label chart-x' },
    ...layout.xLabels.map((a) => s('text', { x: a.x, y: plot.y1 + 18, 'text-anchor': a.anchor, 'data-kind': a.kind }, a.text)),
  );
  const hundred = s('line', { class: 'chart-hundred', x1: plot.x0, x2: plot.x1, y1: layout.hundredY, y2: layout.hundredY });
  // The area between the line and 100: a polygon closed along the 100 line.
  const corners = layout.xs.map((x, i) => `${x},${layout.ys[i]}`).join(' ');
  const area = s('polygon', { class: 'chart-area', points: `${layout.xs[0]},${layout.hundredY} ${corners} ${layout.xs.at(-1)},${layout.hundredY}` });
  const line = s('path', { class: 'chart-line', d: layout.path, 'data-points': layout.xs.length });
  const endDot = s('circle', { class: 'chart-end-dot', cx: layout.xs.at(-1)!, cy: layout.ys.at(-1)!, r: 3.5 });
  // The latest value on a tag that fills the right margin: transparent in Glance (bold text beside
  // the dot), a filled price tag in Desk. The text is centred on the tag.
  const tagX = layout.end.x - 3;
  const tag = s('rect', { class: 'chart-end-tag', x: tagX, y: layout.end.y - 10, width: width - tagX, height: 20, rx: 2 });
  const end = s('text', { class: 'chart-end', x: (tagX + width) / 2, y: layout.end.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, layout.end.label);
  const cross = s('line', { class: 'chart-cross', y1: plot.y0, y2: plot.y1, visibility: 'hidden' });
  const dot = s('circle', { class: 'chart-dot', r: 4.5, visibility: 'hidden' });
  // Over everything, so the pointer is caught anywhere in the plot, not only on the 2px line.
  const hit = s('rect', { class: 'chart-hit', x: 0, y: 0, width, height });
  svg.replaceChildren(grid, axis, area, hundred, yLabels, xLabels, line, tag, end, endDot, cross, dot, hit);
  return { dot, cross };
}

function chart(points: IndexPoint[]): HTMLElement[] {
  const readout = h('p', { class: 'chart-readout', 'aria-live': 'polite', 'data-state': 'idle' }, HINT);
  const svg = s('svg', {
    class: 'chart',
    role: 'img',
    'aria-label': describe(points),
    tabindex: 0,
    'aria-describedby': 'chart-readout',
  });
  readout.id = 'chart-readout';
  const frame = h('div', { class: 'chart-frame' });
  frame.append(svg);

  let layout = layoutChart(points, DEFAULT_WIDTH, heightNow());
  let marks = draw(svg, layout);
  let active: number | null = null;

  const show = (i: number | null) => {
    active = i;
    if (i === null) {
      marks.dot.setAttribute('visibility', 'hidden');
      marks.cross.setAttribute('visibility', 'hidden');
      readout.dataset.state = 'idle';
      readout.replaceChildren(HINT);
      return;
    }
    const x = layout.xs[i]!;
    const y = layout.ys[i]!;
    marks.dot.setAttribute('cx', String(x));
    marks.dot.setAttribute('cy', String(y));
    marks.cross.setAttribute('x1', String(x));
    marks.cross.setAttribute('x2', String(x));
    marks.dot.setAttribute('visibility', 'visible');
    marks.cross.setAttribute('visibility', 'visible');
    const p = points[i]!;
    readout.dataset.state = 'active';
    readout.replaceChildren(
      h('strong', { class: 'chart-readout-value num' }, formatIndex(p.value)),
      ' on ',
      h('time', { datetime: p.date, class: 'num' }, p.date),
    );
  };

  /** The point nearest the pointer, by its x in the SVG's own units. */
  const fromPointer = (e: PointerEvent): number => {
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * layout.width;
    return nearestIndex(layout.xs, x);
  };
  svg.addEventListener('pointerdown', (e) => show(fromPointer(e)));
  svg.addEventListener('pointermove', (e) => show(fromPointer(e)));
  // A mouse leaving clears the readout; a finger lifting leaves it, so a tap can be read.
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') show(null);
  });
  svg.addEventListener('focus', () => {
    if (active === null) show(points.length - 1);
  });
  svg.addEventListener('blur', () => show(null));
  svg.addEventListener('keydown', (e) => {
    const last = points.length - 1;
    const from = active ?? last;
    const next = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: last }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      show(Math.max(0, Math.min(last, next)));
    } else if (e.key === 'Escape') {
      show(null);
    }
  });

  // Draw at the frame's own width once it is on the page, and again whenever it changes.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(([entry]) => {
      const width = Math.floor(entry?.contentRect.width ?? 0);
      const height = heightNow();
      if (width <= 0 || (width === layout.width && height === layout.height)) return;
      layout = layoutChart(points, width, height);
      marks = draw(svg, layout);
      show(active);
    }).observe(frame);
  }
  return [readout, frame];
}

export function renderChart(freshness: Freshness, returns: Returns | null): HTMLElement {
  const title = 'Portfolio value';
  const aside = '2 months · indexed to 100';
  if (freshness.state === 'unreadable') {
    return section('chart', title, aside, errorPlaceholder('No chart', 'The price snapshot could not be read, so there is no line to draw.'));
  }
  if (freshness.state !== 'loaded' || !returns) {
    const quiet =
      freshness.state === 'loading'
        ? placeholder('Loading prices…')
        : placeholder('No price snapshot yet. Build one with ', code('npm run snapshots'), ', so there is no line to draw.');
    return section('chart', title, aside, quiet);
  }
  const points = portfolioIndex(returns);
  if (points.length < 2) return section('chart', title, aside, placeholder(NOT_ENOUGH_TO_DRAW));
  const start = chartStart(returns)!;
  const twoMonths = returns.windows.find((w) => w.window === '2m')?.enough;
  return section(
    'chart',
    title,
    twoMonths ? aside : `since ${start} · indexed to 100`,
    ...chart(points),
    h(
      'p',
      { class: 'section-note' },
      twoMonths
        ? `100 is the portfolio’s value on ${start}, the start of the 2m window; up to the NAV of ${returns.latest}.`
        : `Prices start on ${start}, less than two months back: 100 is the portfolio’s value that day; up to the NAV of ${returns.latest}.`,
    ),
  );
}
