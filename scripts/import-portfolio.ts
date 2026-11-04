// xlsx -> data/portfolio.json.
//
//   npm run import -- distribucion_agregada_cartera.xlsx [--date YYYY-MM-DD]
//
// Reads the advisor's export, matches every fund row to the catalogue (data/funds.json) by its
// exported name, character for character, and rewrites data/portfolio.json. It refuses (exit 1,
// the file left untouched) when a row is something it does not understand, naming the row.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fund } from '../src/lib/portfolio.ts';
import { readSingleSheet, type Row, type Sheet } from '../src/lib/xlsx.ts';

/** The export's header labels, and the label of its total row. */
export const HEADER = { assetClass: 'Clase de activo', fund: 'Fondo', weight: 'Peso agregado' } as const;
export const TOTAL_LABEL = 'Total cartera invertida';
export const SUM_TOLERANCE = 0.0001;

export interface ImportedPosition {
  fund: string;
  weight: number;
  /** The weight exactly as the export writes it, so the JSON keeps every digit. */
  raw: string;
}

/** A refusal: the message names the row and says what is wrong with it. */
export class ImportError extends Error {
  override name = 'ImportError';
}

const text = (row: Row, column: string | undefined): string | undefined => {
  const cell = column ? row.cells.get(column) : undefined;
  if (!cell) return undefined;
  const s = cell.kind === 'string' ? cell.value.trim() : cell.raw;
  return s === '' ? undefined : s;
};

/** Find the header row and the column letter of each of the three columns. */
function findHeader(rows: readonly Row[]): { index: number; fund: string; weight: string; assetClass: string } {
  for (const [index, row] of rows.entries()) {
    const columnOf = (label: string) =>
      [...row.cells].find(([, c]) => c.kind === 'string' && c.value.trim() === label)?.[0];
    const fund = columnOf(HEADER.fund);
    const weight = columnOf(HEADER.weight);
    const assetClass = columnOf(HEADER.assetClass);
    if (fund && weight && assetClass) return { index, fund, weight, assetClass };
  }
  throw new ImportError(
    `no header row "${HEADER.assetClass} | ${HEADER.fund} | ${HEADER.weight}" found: is this the advisor's allocation export?`,
  );
}

/**
 * The positions of the export, in its order, validated against the catalogue. Throws an
 * ImportError naming the row for: a fund not in the catalogue, a fund listed twice, a weight
 * that is missing, not a number or negative, the total row standing where a fund should, rows
 * after the total, and weights that do not sum to 1 within SUM_TOLERANCE.
 */
export function positionsFromSheet(sheet: Sheet, funds: readonly Fund[]): ImportedPosition[] {
  const byName = new Map(funds.map((f) => [f.name, f]));
  const header = findHeader(sheet.rows);
  const positions: ImportedPosition[] = [];
  const rowOf = new Map<string, number>();
  let totalRow: number | undefined;

  for (const row of sheet.rows.slice(header.index + 1)) {
    const at = `row ${row.number}`;
    const name = text(row, header.fund);
    const label = text(row, header.assetClass);
    const weightCell = row.cells.get(header.weight);
    if (row.cells.size === 0) continue; // the blank row before the total

    if (totalRow !== undefined) {
      throw new ImportError(`${at}: there is content after the total row (row ${totalRow}); the export should end there`);
    }
    if (name === undefined && label === TOTAL_LABEL) {
      totalRow = row.number; // "Total cartera invertida | 1": the sum, not a fund
      continue;
    }
    if (name !== undefined && (name === TOTAL_LABEL || label === TOTAL_LABEL)) {
      throw new ImportError(`${at}: "${TOTAL_LABEL}" is the export's total row, and it is standing where a fund should be ("${name}"); it must not be counted as a fund`);
    }
    if (name === undefined) {
      throw new ImportError(`${at}: there is no fund name in the "${HEADER.fund}" column`);
    }
    const fund = byName.get(name);
    if (!fund) {
      throw new ImportError(`${at}: the fund "${name}" is not in data/funds.json (names are matched character for character; add the fund to the catalogue if it is new)`);
    }
    const seen = rowOf.get(fund.id);
    if (seen !== undefined) throw new ImportError(`${at}: the fund "${name}" is listed twice (also in row ${seen})`);

    if (!weightCell) throw new ImportError(`${at} (${name}): the weight is missing`);
    if (weightCell.kind !== 'number' || !Number.isFinite(weightCell.value)) {
      const shown = weightCell.kind === 'string' ? weightCell.value : weightCell.raw;
      throw new ImportError(`${at} (${name}): the weight "${shown}" is not a number`);
    }
    if (weightCell.value < 0) throw new ImportError(`${at} (${name}): the weight ${weightCell.raw} is negative`);

    rowOf.set(fund.id, row.number);
    positions.push({ fund: fund.id, weight: weightCell.value, raw: weightCell.raw });
  }

  if (positions.length === 0) throw new ImportError('the export has a header but no fund rows');
  const sum = positions.reduce((s, p) => s + p.weight, 0);
  if (!(Math.abs(sum - 1) <= SUM_TOLERANCE)) {
    const rows = [...rowOf.values()];
    throw new ImportError(`rows ${rows[0]}–${rows.at(-1)}: the weights sum to ${Number(sum.toPrecision(12))}, not 1 (tolerance ${SUM_TOLERANCE})`);
  }
  return positions;
}

/** A number's text in plain decimal notation, every digit kept: `9.04E-2` -> `0.0904`. */
export function plainDecimal(raw: string): string {
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`"${raw}" is not a decimal number`);
  const sign = m[1] ?? '';
  const intPart = m[2] ?? '';
  const frac = m[3] ?? '';
  const exp = Number(m[4] ?? 0);
  const digits = intPart + frac;
  const point = intPart.length + exp; // where the decimal point falls in `digits`
  let whole: string;
  let fraction: string;
  if (point <= 0) {
    whole = '0';
    fraction = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    whole = digits + '0'.repeat(point - digits.length);
    fraction = '';
  } else {
    whole = digits.slice(0, point);
    fraction = digits.slice(point);
  }
  whole = whole.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '');
  const out = sign + whole + (fraction ? `.${fraction}` : '');
  if (Number(out) !== Number(raw)) throw new Error(`plainDecimal("${raw}") gave "${out}", a different number`);
  return out;
}

/** data/portfolio.json's text: one position per line, weights with the export's own digits. */
export function renderPortfolio(anchorDate: string, sourceFile: string, positions: readonly ImportedPosition[]): string {
  const lines = positions.map(
    (p) => `    { "fund": ${JSON.stringify(p.fund)}, "weight": ${plainDecimal(p.raw)} }`,
  );
  return [
    '{',
    `  "anchorDate": ${JSON.stringify(anchorDate)},`,
    `  "sourceFile": ${JSON.stringify(sourceFile)},`,
    '  "positions": [',
    lines.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

/** Today's date in Madrid, YYYY-MM-DD: the day Alfredo made the export. */
export function todayInMadrid(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now);
}

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface Args {
  file: string;
  date?: string;
}

export function parseArgs(argv: readonly string[]): Args {
  let file: string | undefined;
  let date: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--date' || a.startsWith('--date=')) {
      date = a === '--date' ? argv[++i] : a.slice('--date='.length);
      if (date === undefined || !isIsoDate(date)) throw new ImportError(`--date needs a date written YYYY-MM-DD, got "${date ?? ''}"`);
    } else if (a.startsWith('--')) {
      throw new ImportError(`unknown option ${a}`);
    } else if (file === undefined) {
      file = a;
    } else {
      throw new ImportError(`one export at a time: got "${file}" and "${a}"`);
    }
  }
  if (file === undefined) throw new ImportError('which export? usage: npm run import -- distribucion_agregada_cartera.xlsx [--date YYYY-MM-DD]');
  return { file, date };
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = path.join(root, 'data', 'portfolio.json');
  try {
    const args = parseArgs(process.argv.slice(2));
    // npm runs scripts from the package root; INIT_CWD is where the command was typed.
    const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), args.file);
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(file);
    } catch {
      throw new ImportError(`cannot read ${file}`);
    }
    let sheet: Sheet;
    try {
      sheet = readSingleSheet(bytes);
    } catch (e) {
      throw new ImportError(`${path.basename(file)}: ${(e as Error).message}`, { cause: e });
    }
    const funds = JSON.parse(readFileSync(path.join(root, 'data', 'funds.json'), 'utf8')) as Fund[];
    const positions = positionsFromSheet(sheet, funds);
    const anchorDate = args.date ?? todayInMadrid(new Date());
    const json = renderPortfolio(anchorDate, path.basename(file), positions);
    writeFileSync(`${out}.tmp`, json);
    renameSync(`${out}.tmp`, out);
    const total = positions.reduce((s, p) => s + p.weight, 0);
    console.log(`Wrote ${path.relative(root, out)}: ${positions.length} funds, weights sum to ${total}, anchor date ${anchorDate}.`);
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    console.error(`import refused: ${e.message}\n${path.relative(root, out)} was not changed.`);
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
