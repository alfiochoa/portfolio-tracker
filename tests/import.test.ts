import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import funds from '../data/funds.json' with { type: 'json' };
import type { Fund } from '../src/lib/portfolio.ts';
import { readSingleSheet } from '../src/lib/xlsx.ts';
import {
  ImportError,
  isIsoDate,
  parseArgs,
  plainDecimal,
  positionsFromSheet,
  renderPortfolio,
  todayInMadrid,
} from '../scripts/import-portfolio.ts';
import { exportWorkbook, part, sheetOf } from './fixtures/export.ts';

const catalogue = funds as Fund[];
const HEADER = ['Clase de activo', 'Fondo', 'Peso agregado'];
const US = 'Vanguard US 500 Stock Index Euro - Institutional Plus';
const EU = 'Vanguard European Stock Index Euro - Institutional Plus';
const GOV = 'Vanguard Euro Government Bond Index - Institutional Plus';

/** Import literal rows; the header goes first, the rows are numbered from 2. */
const run = (...rows: (string | number | null)[][]) => positionsFromSheet(sheetOf([HEADER, ...rows]), catalogue);
const refusal = (...rows: (string | number | null)[][]): string => {
  try {
    run(...rows);
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as Error).message;
  }
  throw new Error('the import accepted it');
};

describe('the export of 2026-11-04', () => {
  it('becomes the committed portfolio.json of that day, byte for byte', () => {
    const positions = positionsFromSheet(readSingleSheet(exportWorkbook()), catalogue);
    expect(renderPortfolio('2026-11-04', 'distribucion_agregada_cartera.xlsx', positions)).toBe(part('portfolio.expected.json'));
  });

  it('keeps the export’s order and its unrounded weights', () => {
    const positions = positionsFromSheet(readSingleSheet(exportWorkbook()), catalogue);
    expect(positions.map((p) => p.fund)).toEqual(['us500', 'europe', 'emerging', 'smallcap', 'japan', 'eurogov', 'eurocorp', 'euroinfl']);
    expect(positions[3]).toEqual({ fund: 'smallcap', weight: 0.090423422083395308, raw: '9.0423422083395308E-2' });
  });

  it('every catalogue fund is matched, and the JSON parses back to the same numbers', () => {
    const positions = positionsFromSheet(readSingleSheet(exportWorkbook()), catalogue);
    const json = JSON.parse(renderPortfolio('2026-11-04', 'x.xlsx', positions)) as { positions: { weight: number }[] };
    expect(json.positions.map((p) => p.weight)).toEqual(positions.map((p) => p.weight));
    expect(new Set(positions.map((p) => p.fund))).toEqual(new Set(catalogue.map((f) => f.id)));
  });
});

describe('a valid export', () => {
  it('skips the blank row and reads the total row as the end, not as a fund', () => {
    const positions = run(['Acciones Estados Unidos', US, 0.75], ['Bonos gobiernos europeos', GOV, 0.25], [], ['Total cartera invertida', null, 1]);
    expect(positions.map((p) => p.fund)).toEqual(['us500', 'eurogov']);
  });

  it('accepts weights that sum to 1 within 0.0001', () => {
    expect(run(['', US, 0.70005], ['', GOV, 0.3])).toHaveLength(2);
  });
});

describe('the import refuses, naming the row', () => {
  it('a fund that is not in the catalogue', () => {
    expect(refusal(['Acciones Estados Unidos', US, 0.5], ['Acciones Europa', 'Vanguard European Stock Index Euro - Institutional', 0.5]))
      .toMatch(/^row 3: the fund "Vanguard European Stock Index Euro - Institutional" is not in data\/funds\.json/);
  });

  it('a name that differs by one character (no fuzzy matching)', () => {
    expect(refusal(['', US.replace('500', '500 '), 1])).toMatch(/^row 2: the fund .* is not in data\/funds\.json/);
  });

  it('weights that do not sum to 1 within 0.0001', () => {
    expect(refusal(['', US, 0.7], ['', EU, 0.2], ['', GOV, 0.0998])).toMatch(/^rows 2–4: the weights sum to 0\.9998, not 1/);
    expect(refusal(['', US, 0.7], ['', GOV, 0.30011])).toMatch(/^rows 2–3: the weights sum to 1\.0001/);
  });

  it('a missing weight', () => {
    expect(refusal(['', US, 1], ['', GOV])).toBe(`row 3 (${GOV}): the weight is missing`);
  });

  it('a negative weight', () => {
    expect(refusal(['', US, 1.25], ['', GOV, -0.25])).toBe(`row 3 (${GOV}): the weight -0.25 is negative`);
  });

  it('a weight that is not a number', () => {
    expect(refusal(['', US, '75 %'], ['', GOV, 0.25])).toBe(`row 2 (${US}): the weight "75 %" is not a number`);
  });

  it('the total row counted as a fund', () => {
    expect(refusal(['', US, 0.5], ['', GOV, 0.5], ['', 'Total cartera invertida', 1]))
      .toMatch(/^row 4: "Total cartera invertida" is the export's total row.*must not be counted as a fund/);
    expect(refusal(['', US, 0.5], ['', GOV, 0.5], ['Total cartera invertida', US, 1]))
      .toMatch(/^row 4: "Total cartera invertida" is the export's total row/);
  });

  it('rows after the total row', () => {
    expect(refusal(['', US, 1], ['Total cartera invertida', null, 1], ['', GOV, 0])).toMatch(/^row 4: there is content after the total row \(row 3\)/);
  });

  it('a fund listed twice', () => {
    expect(refusal(['', US, 0.5], ['', US, 0.5])).toBe(`row 3: the fund "${US}" is listed twice (also in row 2)`);
  });

  it('a weight without a fund name', () => {
    expect(refusal(['', US, 0.5], ['Acciones Europa', null, 0.5])).toMatch(/^row 3: there is no fund name/);
  });

  it('a sheet without the header, or without fund rows', () => {
    expect(() => positionsFromSheet(sheetOf([['Fund', 'Weight'], [US, 1]]), catalogue)).toThrow(/no header row/);
    expect(refusal([], ['Total cartera invertida', null, 1])).toBe('the export has a header but no fund rows');
  });
});

describe('plainDecimal keeps every digit the export wrote', () => {
  it.each([
    ['9.0423422083395308E-2', '0.090423422083395308'],
    ['9.299543854430066E-2', '0.09299543854430066'],
    ['0.3983588675690416', '0.3983588675690416'],
    ['1', '1'],
    ['1.5E2', '150'],
    ['2.50E-1', '0.25'],
    ['-3.1e-3', '-0.0031'],
    ['0', '0'],
    ['.5', '0.5'],
  ])('%s -> %s', (raw, plain) => {
    expect(plainDecimal(raw)).toBe(plain);
  });

  it('refuses text that is not a number', () => {
    expect(() => plainDecimal('1,5')).toThrow();
  });
});

describe('dates', () => {
  it('today is the date in Madrid, not in UTC', () => {
    expect(todayInMadrid(new Date('2026-11-04T22:59:59Z'))).toBe('2026-11-04');
    expect(todayInMadrid(new Date('2026-11-04T23:00:00Z'))).toBe('2026-11-05'); // CET, UTC+1
    expect(todayInMadrid(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02'); // CEST, UTC+2
  });

  it('--date takes a real calendar date', () => {
    expect(isIsoDate('2026-11-04')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('04/11/2026')).toBe(false);
  });
});

describe('parseArgs', () => {
  it('reads the file and an optional date', () => {
    expect(parseArgs(['export.xlsx'])).toEqual({ file: 'export.xlsx', date: undefined });
    expect(parseArgs(['export.xlsx', '--date', '2026-10-01'])).toEqual({ file: 'export.xlsx', date: '2026-10-01' });
    expect(parseArgs(['--date=2026-10-01', 'export.xlsx'])).toEqual({ file: 'export.xlsx', date: '2026-10-01' });
  });

  it('refuses a missing file, a bad date and an unknown option', () => {
    expect(() => parseArgs([])).toThrow(/which export/);
    expect(() => parseArgs(['x.xlsx', '--date', '2026-13-01'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['x.xlsx', '--date'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['x.xlsx', '--out', 'y'])).toThrow(/unknown option --out/);
  });
});

it('the committed portfolio.json weights still sum to 1 within 0.0001', () => {
  const committed = JSON.parse(readFileSync(new URL('../data/portfolio.json', import.meta.url), 'utf8')) as { positions: { weight: number }[] };
  expect(Math.abs(committed.positions.reduce((s, p) => s + p.weight, 0) - 1)).toBeLessThanOrEqual(0.0001);
});
