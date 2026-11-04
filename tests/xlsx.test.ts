import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeXml, parseSharedStrings, parseSheetXml, readSingleSheet } from '../src/lib/xlsx.ts';
import { exportWorkbook, part } from './fixtures/export.ts';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

describe('readSingleSheet on the export of 2026-11-04', () => {
  const sheet = readSingleSheet(exportWorkbook());

  it('reads the one sheet, its header and its eleven rows', () => {
    expect(sheet.name).toBe('Distribucion agregada');
    expect(sheet.rows.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const header = sheet.rows[0]!.cells;
    expect([header.get('A'), header.get('B'), header.get('C')]).toEqual([
      { kind: 'string', value: 'Clase de activo' },
      { kind: 'string', value: 'Fondo' },
      { kind: 'string', value: 'Peso agregado' },
    ]);
  });

  it('resolves shared strings, accents included', () => {
    const row6 = sheet.rows[5]!.cells;
    expect(row6.get('A')).toEqual({ kind: 'string', value: 'Acciones Japón' });
    expect(row6.get('B')).toEqual({ kind: 'string', value: 'Vanguard Japan Stock Index Euro - Institutional Plus' });
  });

  it('keeps numbers exactly as written, alongside their value', () => {
    expect(sheet.rows[1]!.cells.get('C')).toEqual({ kind: 'number', value: 0.3983588675690416, raw: '0.3983588675690416' });
    expect(sheet.rows[4]!.cells.get('C')).toEqual({ kind: 'number', value: 0.090423422083395308, raw: '9.0423422083395308E-2' });
  });

  it('reads a styled empty cell as no cell, and the merged total row as label and number', () => {
    expect(sheet.rows[9]!.cells.size).toBe(0);
    const total = sheet.rows[10]!.cells;
    expect([...total.keys()]).toEqual(['A', 'C']);
    expect(total.get('A')).toEqual({ kind: 'string', value: 'Total cartera invertida' });
    expect(total.get('C')).toEqual({ kind: 'number', value: 1, raw: '1' });
  });
});

describe('readSingleSheet refuses what it does not know', () => {
  it('a file that is not a zip', () => {
    expect(() => readSingleSheet(new TextEncoder().encode('Clase de activo;Fondo;Peso'))).toThrow(/not an \.xlsx file/);
  });

  it('a zip without a workbook', () => {
    expect(() => readSingleSheet(exportWorkbook({ 'xl/workbook.xml': null }))).toThrow(/"xl\/workbook\.xml" is missing/);
  });

  it('a workbook with two sheets', () => {
    const two = part('workbook.xml').replace('</sheets>', '<sheet name="Otra" sheetId="2" r:id="rId9"/></sheets>');
    expect(() => readSingleSheet(exportWorkbook({ 'xl/workbook.xml': two }))).toThrow(/2 sheets/);
  });

  it('a sheet whose worksheet part is missing', () => {
    expect(() => readSingleSheet(exportWorkbook({ 'xl/worksheets/sheet1.xml': null }))).toThrow(/sheet1\.xml" is missing/);
  });
});

describe('parseSharedStrings', () => {
  it('reads plain items, rich-text runs, entities and empty items, skipping phonetic hints', () => {
    const xml = `<sst ${NS}><si><t>Fondo</t></si><si><r><t>Bonos </t></r><r><rPr><b/></rPr><t xml:space="preserve">&amp; más</t></r></si><si/><si><t>A&#xE9;&#233;</t><rPh><t>x</t></rPh></si></sst>`;
    expect(parseSharedStrings(xml)).toEqual(['Fondo', 'Bonos & más', '', 'Aéé']);
  });

  it('reads the export’s twenty strings', () => {
    const strings = parseSharedStrings(part('sharedStrings.xml'));
    expect(strings).toHaveLength(20);
    expect(strings[19]).toBe('Total cartera invertida');
  });
});

describe('parseSheetXml', () => {
  const sheet = (rows: string) => `<worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;

  it('reads inline strings, formula strings and self-closing rows', () => {
    const rows = parseSheetXml(
      sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Fondo</t></is></c><c r="B1" t="str"><f>A1</f><v>Fondo</v></c></row><row r="3"/>'),
      [],
    );
    expect(rows).toEqual([
      { number: 1, cells: new Map([['A', { kind: 'string', value: 'Fondo' }], ['B', { kind: 'string', value: 'Fondo' }]]) },
      { number: 3, cells: new Map() },
    ]);
  });

  it('refuses a cell type it does not handle, a missing shared string and a malformed number', () => {
    expect(() => parseSheetXml(sheet('<row r="1"><c r="A1" t="b"><v>1</v></c></row>'), [])).toThrow(/A1: cell type "b"/);
    expect(() => parseSheetXml(sheet('<row r="1"><c r="A1" t="s"><v>4</v></c></row>'), ['x'])).toThrow(/shared string 4/);
    expect(() => parseSheetXml(sheet('<row r="1"><c r="C1"><v>0,25</v></c></row>'), [])).toThrow(/"0,25" is not a number/);
  });

  it('decodes entities once, not twice', () => {
    expect(decodeXml('&amp;lt; &lt; &#38;')).toBe('&lt; < &');
  });
});

describe('the page never loads the reader', () => {
  // Walk src/main.ts's static imports: neither src/lib/xlsx.ts nor fflate may be reachable,
  // so neither can end up in dist/.
  const reachable = (entry: URL, seen = new Set<string>()): Set<string> => {
    if (seen.has(entry.href)) return seen;
    seen.add(entry.href);
    const source = readFileSync(entry, 'utf8');
    for (const m of source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2] ?? m[3] ?? '';
      if (spec.startsWith('.')) {
        if (/\.(ts|js)$/.test(spec)) reachable(new URL(spec, entry), seen);
        else if (!/\.(css|json|svg)$/.test(spec)) reachable(new URL(`${spec}.ts`, entry), seen);
      } else seen.add(spec);
    }
    return seen;
  };

  it('src/main.ts reaches neither src/lib/xlsx.ts nor fflate', () => {
    const graph = [...reachable(new URL('../src/main.ts', import.meta.url))];
    expect(graph.some((s) => s.endsWith('/src/main.ts'))).toBe(true);
    expect(graph.length).toBeGreaterThan(2);
    expect(graph.filter((s) => s.endsWith('/xlsx.ts') || s.includes('fflate'))).toEqual([]);
  });
});
