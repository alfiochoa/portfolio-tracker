// The chart's numbers: which points, indexed how, where each lands, and the gridlines.
import { describe, expect, it } from 'vitest';
import {
  chartHeight,
  chartStart,
  fundIndex,
  indexFrom,
  layoutChart,
  monthStarts,
  nearestIndex,
  niceScale,
  portfolioIndex,
  sparkPath,
  textWidth,
  timeScale,
  type IndexPoint,
} from '../src/lib/chart.ts';
import { computeReturns } from '../src/lib/returns.ts';
import { three } from './fixtures/returns.ts';

describe('the points', () => {
  it('index the values from a start date to 100', () => {
    const dates = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'];
    expect(indexFrom(dates, [0.8, 1.0, 1.1, 0.95], '2026-10-02')).toEqual([
      { date: '2026-10-02', value: 100 },
      { date: '2026-10-05', value: expect.closeTo(110, 10) },
      { date: '2026-10-06', value: expect.closeTo(95, 10) },
    ]);
    expect(indexFrom(dates, [1, 1, 1, 1], '2026-10-03')).toEqual([]);
  });

  it('cover the 2m window of the three-fund fixture: S_2m = 2026-09-03 to L, nine points', () => {
    const r = computeReturns(three.portfolio, three.funds);
    expect(chartStart(r)).toBe('2026-09-03');
    const points = portfolioIndex(r);
    expect(points.map((p) => p.date)).toEqual(r.dates.slice(1));
    expect(points[0]).toEqual({ date: '2026-09-03', value: 100 });
    // V(S) = 0.5·9.5/12.5 + 0.3·21/19 + 0.2·40/42 = 0.38 + 63/190 + 4/21; V(L) = 42001/39900 (tests/returns.test.ts).
    const vS = 0.38 + 63 / 190 + 4 / 21;
    expect(points.at(-1)!.value).toBeCloseTo(((42001 / 39900) / vS) * 100, 10);
  });

  it('cover what there is, from the first date, when the series is shorter than two months', () => {
    const short = { dates: ['2026-10-27', '2026-10-28', '2026-10-29'], values: [1, 1.01, 0.99], windows: [{ window: '2m' as const, enough: false as const }] };
    expect(chartStart(short)).toBe('2026-10-27');
    expect(portfolioIndex(short).map((p) => p.value)).toEqual([100, expect.closeTo(101, 10), expect.closeTo(99, 10)]);
    expect(portfolioIndex({ dates: [], values: [], windows: [] })).toEqual([]);
  });

  it("give a fund its own line, a date the portfolio dropped included, indexed to its NAV on the start", () => {
    const bars: [string, number][] = [
      ['2026-08-31', 40],
      ['2026-09-03', 50],
      ['2026-10-26', 55], // dropped from the portfolio series, kept here
      ['2026-11-03', 45],
      ['2026-11-04', 60], // after L
    ];
    expect(fundIndex(bars, '2026-09-03', '2026-11-03')).toEqual([
      { date: '2026-09-03', value: 100 },
      { date: '2026-10-26', value: expect.closeTo(110, 10) },
      { date: '2026-11-03', value: expect.closeTo(90, 10) },
    ]);
    expect(fundIndex(bars, '2026-09-02', '2026-11-03')).toEqual([]); // no NAV on the start
  });
});

describe('the x axis is calendar time', () => {
  it('places dates by day, so a weekend leaves a gap and a dropped date leaves a hole', () => {
    const x = timeScale('2026-10-01', '2026-10-31', 0, 300);
    expect(x('2026-10-01')).toBe(0);
    expect(x('2026-10-31')).toBe(300);
    expect(x('2026-10-02')).toBe(10); // Thu -> Fri: one day
    expect(x('2026-10-05')).toBe(40); // Fri -> Mon: three days, three times the space
  });

  it('lists the month boundaries inside the window', () => {
    expect(monthStarts('2026-09-03', '2026-11-03')).toEqual(['2026-10-01', '2026-11-01']);
    expect(monthStarts('2026-09-01', '2026-11-03')).toEqual(['2026-10-01', '2026-11-01']); // the start itself is not a boundary
    expect(monthStarts('2026-11-15', '2027-01-02')).toEqual(['2026-12-01', '2027-01-01']);
    expect(monthStarts('2026-10-27', '2026-10-31')).toEqual([]);
  });
});

describe('the y-range', () => {
  it('pads the values and lands on round gridlines', () => {
    expect(niceScale(99.77, 104.1)).toEqual({ lo: 98, hi: 106, ticks: [98, 100, 102, 104, 106], decimals: 0 });
    expect(niceScale(100, 108.49)).toEqual({ lo: 95, hi: 110, ticks: [95, 100, 105, 110], decimals: 0 });
    // Padded to 97.165..100.135: a step of 0.5 needs eight gridlines, 1 needs five.
    expect(niceScale(97.3, 100)).toEqual({ lo: 97, hi: 101, ticks: [97, 98, 99, 100, 101], decimals: 0 });
    // A quiet fortnight: 99.9..100.3, padded by 0.02, steps of 0.1.
    expect(niceScale(99.9, 100.3)).toEqual({ lo: 99.8, hi: 100.4, ticks: [99.8, 100, 100.2, 100.4], decimals: 1 });
  });

  it('gives a flat line half a point either side', () => {
    const s = niceScale(100, 100);
    expect(s.lo).toBeLessThan(100);
    expect(s.hi).toBeGreaterThan(100);
    expect(s.ticks).toContain(100);
  });

  it('always has three to five gridlines, round values, the data inside, and 100 among them when it is in range', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 5000; i++) {
      const spread = 10 ** (random() * 4 - 2); // 0.01 to 100 index points
      const min = 100 - random() * spread;
      const max = 100 + random() * spread;
      const s = niceScale(min, max);
      expect(s.ticks.length, `${min}..${max}`).toBeGreaterThanOrEqual(3);
      expect(s.ticks.length, `${min}..${max}`).toBeLessThanOrEqual(5);
      expect(s.lo).toBeLessThan(min);
      expect(s.hi).toBeGreaterThan(max);
      expect(s.ticks[0]).toBe(s.lo);
      expect(s.ticks.at(-1)).toBe(s.hi);
      expect(s.ticks).toContain(100);
    }
  });
});

describe('the layout', () => {
  // The e2e fixture's 2m index, by hand (e2e/smoke.spec.ts): 100 on 2026-09-01, 108.49 on 2026-11-03.
  const points: IndexPoint[] = [
    ['2026-09-01', 100],
    ['2026-10-01', 108.49],
    ['2026-10-27', 113.0],
    ['2026-10-28', 112.0],
    ['2026-10-29', 111.0],
    ['2026-10-30', 110.5],
    ['2026-11-02', 109.5],
    ['2026-11-03', 108.49],
  ].map(([date, value]) => ({ date: date as string, value: value as number }));

  for (const width of [328, 928]) {
    it(`fits a ${width} px chart: one path command per point, x by date, labels inside the SVG`, () => {
      const l = layoutChart(points, width);
      expect(l.height).toBe(chartHeight(width));
      expect(l.path.match(/[ML]/g)).toHaveLength(points.length);
      expect(l.xs[0]).toBe(l.plot.x0);
      expect(l.xs.at(-1)).toBe(l.plot.x1);
      // 2026-09-01 -> 2026-10-01 is 30 of the 63 days.
      expect(l.xs[1]! - l.xs[0]!).toBeCloseTo(((l.plot.x1 - l.plot.x0) * 30) / 63, 1);
      expect(l.ys[0]).toBe(l.hundredY);
      expect(l.gridlines.length).toBeGreaterThanOrEqual(3);
      expect(l.gridlines.length).toBeLessThanOrEqual(5);
      expect(l.gridlines.map((g) => g.label)).toEqual(['95', '100', '105', '110', '115']);
      for (const y of l.ys) {
        expect(y).toBeGreaterThanOrEqual(l.plot.y0);
        expect(y).toBeLessThanOrEqual(l.plot.y1);
      }
      expect(l.end).toEqual({ x: expect.any(Number), y: l.ys.at(-1), label: '108.49' });
      expect(l.end.x + textWidth(l.end.label)).toBeLessThanOrEqual(width);
      // Gridline labels fit left of the plot.
      for (const g of l.gridlines) expect(textWidth(g.label)).toBeLessThan(l.plot.x0);
    });
  }

  it('labels the first and last dates and each month that does not touch them', () => {
    // "Nov" (two days before the end) would run into "2026-11-03", on a laptop and a phone alike:
    // its tick stays, its name goes.
    const wide = layoutChart(points, 928);
    expect(wide.xLabels.map((a) => a.text)).toEqual(['2026-09-01', 'Oct', '2026-11-03']);
    expect(wide.monthTicks).toHaveLength(2);
    const phone = layoutChart(points, 328);
    expect(phone.xLabels.map((a) => a.text)).toEqual(['2026-09-01', 'Oct', '2026-11-03']);
    // Later in the month there is room for it.
    const later = layoutChart([...points, { date: '2026-11-20', value: 107 }], 928);
    expect(later.xLabels.map((a) => a.text)).toEqual(['2026-09-01', 'Oct', 'Nov', '2026-11-20']);
    // No two labels overlap.
    for (const l of [wide, phone, later]) {
      const boxes = l.xLabels.map((a) => {
        const w = textWidth(a.text);
        const left = a.anchor === 'start' ? a.x : a.anchor === 'end' ? a.x - w : a.x - w / 2;
        return [left, left + w] as const;
      });
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]![0]).toBeGreaterThan(boxes[i - 1]![1]);
      expect(boxes[0]![0]).toBeGreaterThanOrEqual(0);
      expect(boxes.at(-1)![1]).toBeLessThanOrEqual(l.width);
    }
  });

  it('refuses fewer than two points', () => {
    expect(() => layoutChart(points.slice(0, 1), 328)).toThrow('two points');
  });

  it('finds the point nearest a pointer', () => {
    const xs = [0, 10, 40, 50];
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 24)).toBe(1);
    expect(nearestIndex(xs, 26)).toBe(2);
    expect(nearestIndex(xs, 25)).toBe(1); // a tie goes to the earlier
    expect(nearestIndex(xs, 99)).toBe(3);
  });
});

describe('a sparkline', () => {
  it("shares the chart's x mapping and spans its own range inside the box", () => {
    const pts: IndexPoint[] = [
      { date: '2026-09-01', value: 100 },
      { date: '2026-09-11', value: 104 },
      { date: '2026-10-01', value: 96 },
    ];
    // 30 days over 60 units: 2026-09-11 is at 20. 104 is the top (inset 2), 96 the bottom.
    expect(sparkPath(pts, '2026-09-01', '2026-10-01', 60, 20)).toBe('M0 10 L20 2 L60 18');
    expect(sparkPath(pts.slice(0, 1), '2026-09-01', '2026-10-01', 60, 20)).toBe('');
    expect(sparkPath([pts[0]!, { date: '2026-10-01', value: 100 }], '2026-09-01', '2026-10-01', 60, 20)).toBe('M0 10 L60 10');
  });
});
