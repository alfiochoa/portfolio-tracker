// The export's XML parts (tests/fixtures/export/), zipped back into an .xlsx in memory,
// and a builder for small sheets written out as literal rows.
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import type { Cell, Row, Sheet } from '../../src/lib/xlsx.ts';

const dir = new URL('./export/', import.meta.url);
export const part = (name: string): string => readFileSync(new URL(name, dir), 'utf8');

/** The export as a workbook; `overrides` replaces (string) or removes (null) a part by its zip path. */
export function exportWorkbook(overrides: Record<string, string | null> = {}): Uint8Array {
  const parts: Record<string, string | null> = {
    'xl/workbook.xml': part('workbook.xml'),
    'xl/_rels/workbook.xml.rels': part('workbook.xml.rels'),
    'xl/sharedStrings.xml': part('sharedStrings.xml'),
    'xl/worksheets/sheet1.xml': part('sheet1.xml'),
    ...overrides,
  };
  const files: Record<string, Uint8Array> = {};
  for (const [path, xml] of Object.entries(parts)) if (xml !== null) files[path] = strToU8(xml);
  return zipSync(files);
}

type Value = string | number | null;

/**
 * A sheet from literal rows of [asset class, fund, weight], numbered from 1 as Excel does.
 * Numbers become number cells (raw = String(n)), strings string cells, null an empty cell.
 */
export function sheetOf(rows: readonly (readonly Value[])[]): Sheet {
  return {
    name: 'Distribucion agregada',
    rows: rows.map((values, i): Row => {
      const cells = new Map<string, Cell>();
      values.forEach((v, j) => {
        const column = 'ABC'[j] ?? 'Z';
        if (typeof v === 'number') cells.set(column, { kind: 'number', value: v, raw: String(v) });
        else if (typeof v === 'string') cells.set(column, { kind: 'string', value: v });
      });
      return { number: i + 1, cells };
    }),
  };
}
