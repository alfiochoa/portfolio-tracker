// A minimal SpreadsheetML reader for the advisor's export, and nothing more general.
//
// It handles exactly the shape of `distribucion_agregada_cartera.xlsx`: a workbook with one
// sheet, cells that are shared strings (`t="s"`), inline strings or plain numbers. Anything
// else (formulas without a cached value, booleans, errors, dates, several sheets) is refused
// with a message rather than guessed. Used only by scripts/import-portfolio.ts and its tests:
// it must never be imported by src/main.ts (a test walks the page's import graph).
import { strFromU8, unzipSync } from 'fflate';

export type Cell =
  | { kind: 'string'; value: string }
  /** `raw` is the number exactly as written in the file, e.g. `9.0423422083395308E-2`. */
  | { kind: 'number'; value: number; raw: string };

export interface Row {
  /** The spreadsheet's 1-based row number, as Excel shows it. */
  number: number;
  /** Cells keyed by column letter (`A`, `B`, ...). Cells without a value are absent. */
  cells: Map<string, Cell>;
}

export interface Sheet {
  name: string;
  rows: Row[];
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Decode the five XML entities and numeric character references. */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, ref: string) => {
    switch (ref) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default:
        return String.fromCodePoint(ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10));
    }
  });
}

/** The value of attribute `name` in a tag's attribute text, or undefined. */
function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m?.[1] === undefined ? undefined : decodeXml(m[1]);
}

/** The text of every `<t>` inside a fragment, concatenated (plain and rich-text runs alike). */
function textOf(fragment: string): string {
  let out = '';
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1] ?? '');
  return out;
}

/** `xl/sharedStrings.xml`: the table that `t="s"` cells index into. */
export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    // Phonetic runs (<rPh>) are pronunciation hints, not part of the text.
    strings.push(textOf((m[1] ?? '').replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
  }
  return strings;
}

/** A worksheet part (`xl/worksheets/sheetN.xml`) into rows of typed cells. */
export function parseSheetXml(xml: string, sharedStrings: readonly string[]): Row[] {
  const rows: Row[] = [];
  for (const rm of xml.matchAll(/<row(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const number = Number(attr(rm[1] ?? '', 'r'));
    if (!Number.isInteger(number)) throw new Error('a <row> without a row number ("r")');
    const cells = new Map<string, Cell>();
    for (const cm of (rm[2] ?? '').matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? '';
      const ref = attr(attrs, 'r') ?? '';
      const column = /^([A-Z]+)\d+$/.exec(ref)?.[1];
      if (!column) throw new Error(`row ${number}: a cell without a reference like "B4"`);
      const type = attr(attrs, 't') ?? 'n';
      const body = cm[2] ?? '';
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let cell: Cell | undefined;
      if (type === 'inlineStr') {
        cell = { kind: 'string', value: textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '') };
      } else if (v === undefined) {
        cell = undefined; // a styled but empty cell
      } else if (type === 's') {
        const value = sharedStrings[Number(v)];
        if (value === undefined) throw new Error(`cell ${ref}: shared string ${v} does not exist`);
        cell = { kind: 'string', value };
      } else if (type === 'str') {
        cell = { kind: 'string', value: decodeXml(v) };
      } else if (type === 'n') {
        const raw = v.trim();
        if (!NUMBER.test(raw)) throw new Error(`cell ${ref}: "${raw}" is not a number`);
        cell = { kind: 'number', value: Number(raw), raw };
      } else {
        throw new Error(`cell ${ref}: cell type "${type}" is not one this reader handles`);
      }
      if (cell) cells.set(column, cell);
    }
    rows.push({ number, cells });
  }
  return rows;
}

/** Resolve a relationship target against the folder of the part that declares it. */
function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** The relationships of a part: id -> { type, target part path }. */
function relationships(xml: string, owner: string): Map<string, { type: string; target: string }> {
  const rels = new Map<string, { type: string; target: string }>();
  for (const m of xml.matchAll(/<Relationship(\s[^>]*?)\/?>/g)) {
    const a = m[1] ?? '';
    const id = attr(a, 'Id');
    const target = attr(a, 'Target');
    if (id && target) rels.set(id, { type: attr(a, 'Type') ?? '', target: resolvePart(owner, target) });
  }
  return rels;
}

/**
 * Read the one sheet of an .xlsx file. Refuses a workbook with more or fewer than one sheet:
 * the export has exactly one, and a second would mean the advisor changed its format.
 */
export function readSingleSheet(bytes: Uint8Array): Sheet {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  } catch (e) {
    throw new Error(`not an .xlsx file (it does not unzip: ${(e as Error).message})`, { cause: e });
  }
  const part = (path: string): string => {
    const data = files[path];
    if (!data) throw new Error(`not an .xlsx export: the part "${path}" is missing`);
    return strFromU8(data);
  };

  const workbookPath = 'xl/workbook.xml';
  const workbook = part(workbookPath);
  const sheets = [...workbook.matchAll(/<sheet(\s[^>]*?)\/?>/g)].map((m) => m[1] ?? '');
  if (sheets.length !== 1) {
    throw new Error(`the workbook has ${sheets.length} sheets; the export this reader knows has exactly one`);
  }
  const sheetAttrs = sheets[0] ?? '';
  const name = attr(sheetAttrs, 'name') ?? '';
  const relId = attr(sheetAttrs, 'r:id');

  const rels = relationships(part('xl/_rels/workbook.xml.rels'), workbookPath);
  const sheetPath = relId ? rels.get(relId)?.target : undefined;
  if (!sheetPath) throw new Error(`the sheet "${name}" has no worksheet part`);
  const sstPath = [...rels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.target;
  const sharedStrings = sstPath ? parseSharedStrings(part(sstPath)) : [];

  return { name, rows: parseSheetXml(part(sheetPath), sharedStrings) };
}
