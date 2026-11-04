// The two-month chart and the sparklines, as numbers: which points, the y-range and its gridlines,
// the x position of a date, and the axis labels. Pure: no DOM; src/ui/chart.ts draws what this returns.
//
// The chart covers the 2m window (SPEC "Exact definitions"): the portfolio series from S_2m to L,
// each point V(t) / V(S_2m) × 100. When the series does not reach back two months, it covers what
// there is (every series date is then inside the window), indexed to its first date. Time on the x
// axis is calendar time: a weekend, or a date dropped from the series, leaves its space empty.
import type { Bar } from './yahoo.ts';
import type { Returns } from './returns.ts';

export interface IndexPoint {
  date: string;
  /** 100 at the window's first point. */
  value: number;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** The first date the chart covers: S_2m, or the series' first date when it is shorter than two months. */
export function chartStart(returns: Pick<Returns, 'dates' | 'windows'>): string | undefined {
  const w = returns.windows.find((x) => x.window === '2m');
  return w?.enough ? w.start : returns.dates[0];
}

/** `values[i]` on `dates[i]`, from `start` on, indexed so that the value on `start` is 100. Empty when `start` is not a date of the series. */
export function indexFrom(dates: readonly string[], values: readonly number[], start: string): IndexPoint[] {
  const s = dates.indexOf(start);
  if (s < 0) return [];
  const base = values[s]!;
  return dates.slice(s).map((date, i) => ({ date, value: (values[s + i]! / base) * 100 }));
}

/** The portfolio's value index over the chart's window. */
export function portfolioIndex(returns: Pick<Returns, 'dates' | 'values' | 'windows'>): IndexPoint[] {
  const start = chartStart(returns);
  return start === undefined ? [] : indexFrom(returns.dates, returns.values, start);
}

/**
 * A fund's own index over the same window: its bars from `start` to `latest` (both series dates, so
 * the fund has a NAV on each), indexed to its NAV on `start`. A date the portfolio series dropped
 * but this fund has is kept: it is the fund's own line.
 */
export function fundIndex(bars: readonly Bar[], start: string, latest: string): IndexPoint[] {
  const inWindow = bars.filter(([d]) => d >= start && d <= latest);
  if (inWindow[0]?.[0] !== start) return [];
  const base = inWindow[0][1];
  return inWindow.map(([date, nav]) => ({ date, value: (nav / base) * 100 }));
}

/** The x position of a date: `first` at `x0`, `last` at `x1`, proportional to calendar days. */
export function timeScale(first: string, last: string, x0: number, x1: number): (date: string) => number {
  const d0 = dayNumber(first);
  const span = dayNumber(last) - d0;
  return (date) => (span === 0 ? (x0 + x1) / 2 : x0 + ((dayNumber(date) - d0) / span) * (x1 - x0));
}

export interface NiceScale {
  /** The domain, from the lowest gridline to the highest. */
  lo: number;
  hi: number;
  /** The gridline values, ascending, `lo` and `hi` included: three to five of them. */
  ticks: number[];
  /** Decimals a tick label needs (0 for a step of 1 or more, 1 for 2.5 or 0.5, …). */
  decimals: number;
}

/** Steps of 1, 2, 2.5 and 5 times a power of ten, smallest first, around `raw`. */
function candidateSteps(raw: number): number[] {
  const p = Math.floor(Math.log10(raw)) - 1;
  const steps: number[] = [];
  for (let k = p; k <= p + 2; k++) for (const m of [1, 2, 2.5, 5]) steps.push(m * 10 ** k);
  return steps;
}

const decimalsOf = (step: number): number => {
  for (let d = 0; d <= 10; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-9) return d;
  return 10;
};

/**
 * The y-range for values from `min` to `max`: padded by a twentieth of the span on each side (at
 * least ±0.5 when the values are flat), then widened to the nearest gridlines of the smallest round
 * step that needs no more than five of them. The line never touches the top or bottom edge unless a
 * value sits exactly on a gridline after padding.
 */
export function niceScale(min: number, max: number): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new Error(`not a range: ${min} to ${max}`);
  const span = max - min;
  const pad = span === 0 ? 0.5 : span / 20;
  const lo0 = min - pad;
  const hi0 = max + pad;
  for (const step of candidateSteps((hi0 - lo0) / 4)) {
    const decimals = decimalsOf(step);
    const round = (v: number) => Number(v.toFixed(decimals));
    const lo = round(Math.floor(lo0 / step + 1e-9) * step);
    const hi = round(Math.ceil(hi0 / step - 1e-9) * step);
    const n = Math.round((hi - lo) / step) + 1;
    // The smallest step that needs five or fewer. Never fewer than three: the step before it needed
    // six or more, and steps grow by at most 2.5 times (tests/chart.test.ts tries many ranges).
    if (n > 5) continue;
    const ticks = Array.from({ length: n }, (_, i) => round(lo + i * step));
    return { lo, hi, ticks, decimals };
  }
  throw new Error(`no scale for ${min} to ${max}`); // unreachable: the largest candidate always fits
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The first day of each month after `first` and up to `last`, as dates. */
export function monthStarts(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number) as [number, number];
  for (;;) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const date = `${y}-${String(m).padStart(2, '0')}-01`;
    if (date > last) return out;
    out.push(date);
  }
}

/** A month's short English name, from a date in it. */
export const monthName = (date: string): string => MONTHS[Number(date.slice(5, 7)) - 1]!;

/** Text metrics without a DOM: the chart's labels are digits, dashes and short month names. */
export interface TextMetrics {
  /** The label font's size, in px (= user units: the SVG is drawn at its own pixel width). */
  fontSize: number;
  /**
   * A generous character width, as a fraction of the font size: the widest measured is DejaVu
   * Sans's semibold digit (0.696, Linux's system-ui); San Francisco's are narrower. Overestimating
   * costs a few pixels of margin; underestimating runs the end label off the chart.
   */
  charWidth: number;
}

export const LABEL_TEXT: TextMetrics = { fontSize: 12, charWidth: 0.72 };
export const textWidth = (text: string, m: TextMetrics = LABEL_TEXT): number => text.length * m.fontSize * m.charWidth;

export interface AxisLabel {
  x: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
  kind: 'end' | 'month';
}

export interface ChartLayout {
  width: number;
  height: number;
  /** The plot area. */
  plot: { x0: number; x1: number; y0: number; y1: number };
  /** One per point, in order. */
  xs: number[];
  ys: number[];
  /** The line: `M x y L x y …`, one command per point. */
  path: string;
  /** The gridlines, low to high, with their labels. */
  gridlines: { value: number; y: number; label: string }[];
  /** Where 100 is (the window's start): always inside the domain, since the first point is 100. */
  hundredY: number;
  /** A short tick on the x axis at each month boundary, labelled when the label fits. */
  monthTicks: number[];
  xLabels: AxisLabel[];
  /** The latest value's label, beside the line's end. */
  end: { x: number; y: number; label: string };
}

const GAP = 6;
const TOP = 10;
const BOTTOM = 26;

/** The chart's height for a width: taller than wide is never right; a phone gets a fixed, readable 200. */
export function chartHeight(width: number): number {
  return Math.round(Math.min(320, Math.max(200, width * 0.36)));
}

/** The index value as the chart writes it: two decimals, so 108.49 reads as the 2m tile's +8.49 %. */
export const formatIndex = (value: number): string => value.toFixed(2);

/**
 * Everything the chart draws, in user units of an SVG `width` × `height` (drawn at its own pixel
 * size, so a label is `LABEL_TEXT.fontSize` px on every screen). Needs two points or more.
 */
export function layoutChart(points: readonly IndexPoint[], width: number, height: number = chartHeight(width)): ChartLayout {
  if (points.length < 2) throw new Error('a chart needs two points or more');
  const values = points.map((p) => p.value);
  const scale = niceScale(Math.min(...values), Math.max(...values));
  const labels = scale.ticks.map((t) => t.toFixed(scale.decimals));
  const last = points[points.length - 1]!;
  const endLabel = formatIndex(last.value);

  const first = points[0]!.date;
  const lastLabel = last.date;
  const x0 = Math.ceil(Math.max(...labels.map((l) => textWidth(l))) + GAP);
  // Room on the right for the end label; the last date's label, anchored at the end, must fit too.
  const x1 = Math.floor(width - textWidth(endLabel) - GAP);
  const y0 = TOP;
  const y1 = height - BOTTOM;
  const x = timeScale(first, last.date, x0, x1);
  const y = (v: number) => y1 - ((v - scale.lo) / (scale.hi - scale.lo)) * (y1 - y0);
  const round = (n: number) => Math.round(n * 100) / 100;

  const xs = points.map((p) => round(x(p.date)));
  const ys = points.map((p) => round(y(p.value)));
  const path = xs.map((px, i) => `${i === 0 ? 'M' : 'L'}${px} ${ys[i]}`).join(' ');

  // The x axis: the first date at the plot's left, the last at its right (anchored inward so neither
  // runs off the SVG), and each month boundary's name, dropped when it would touch an end label.
  const firstLabel: AxisLabel = { x: x0, text: first, anchor: 'start', kind: 'end' };
  const endDate: AxisLabel = { x: x1, text: lastLabel, anchor: 'end', kind: 'end' };
  const occupied: [number, number][] = [
    [x0, x0 + textWidth(first)],
    [x1 - textWidth(lastLabel), x1],
  ];
  const months = monthStarts(first, last.date);
  const monthTicks = months.map((d) => round(x(d)));
  const monthLabels: AxisLabel[] = [];
  months.forEach((d, i) => {
    const text = monthName(d);
    const cx = monthTicks[i]!;
    const half = textWidth(text) / 2;
    const box: [number, number] = [cx - half - GAP, cx + half + GAP];
    if (occupied.some(([a, b]) => box[0] < b && box[1] > a)) return;
    occupied.push([cx - half, cx + half]);
    monthLabels.push({ x: cx, text, anchor: 'middle', kind: 'month' });
  });

  return {
    width,
    height,
    plot: { x0, x1, y0, y1 },
    xs,
    ys,
    path,
    gridlines: scale.ticks.map((value, i) => ({ value, y: round(y(value)), label: labels[i]! })),
    hundredY: round(y(100)),
    monthTicks,
    xLabels: [firstLabel, ...monthLabels, endDate],
    end: { x: round(x1 + GAP), y: ys[ys.length - 1]!, label: endLabel },
  };
}

/** The index of the x in `xs` (ascending) nearest to `x`; ties go to the earlier point. */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x)) best = i;
  return best;
}

/**
 * A sparkline's path in a `width` × `height` box, x by calendar date from `first` to `last` (the
 * chart's window, so every sparkline shares the chart's x mapping), y from the points' own range
 * with `inset` kept clear top and bottom so the stroke is never clipped.
 */
export function sparkPath(points: readonly IndexPoint[], first: string, last: string, width: number, height: number, inset = 2): string {
  if (points.length < 2) return '';
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = timeScale(first, last, 0, width);
  const y = (v: number) => (hi === lo ? height / 2 : height - inset - ((v - lo) / (hi - lo)) * (height - 2 * inset));
  const round = (n: number) => Math.round(n * 100) / 100;
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(x(p.date))} ${round(y(p.value))}`).join(' ');
}
