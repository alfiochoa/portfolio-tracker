// How numbers and dates read on the screen (SPEC "Display"). Round here, at display time only.

const MINUS = '−';

/** Hundredths of a percent, as an integer, rounded half away from zero. */
function hundredths(fraction: number): number {
  if (!Number.isFinite(fraction)) throw new Error(`not a number: ${fraction}`);
  const scaled = Math.abs(fraction) * 10000;
  // A small nudge so values like 0.123450000001 or 0.12345 (stored as 0.1234499…) round as written.
  return Math.sign(fraction) * Math.round(scaled + scaled * Number.EPSILON * 4);
}

function percentDigits(h: number): string {
  const abs = Math.abs(h);
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** A weight or share: `90.34 %`, never signed. */
export function formatPercent(fraction: number): string {
  const h = hundredths(fraction);
  return `${h < 0 ? MINUS : ''}${percentDigits(h)} %`;
}

/** A return: `+1.23 %`, `−0.45 %` (a true minus sign), and `0.00 %` when it rounds to zero. */
export function formatSignedPercent(fraction: number): string {
  const h = hundredths(fraction);
  const sign = h > 0 ? '+' : h < 0 ? MINUS : '';
  return `${sign}${percentDigits(h)} %`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date as `2026-11-03`. Takes an ISO date string (checked, returned as is) or a Date (its UTC day). */
export function formatDate(date: string | Date): string {
  if (typeof date === 'string') {
    if (!ISO_DATE.test(date)) throw new Error(`not an ISO date: ${date}`);
    return date;
  }
  if (Number.isNaN(date.getTime())) throw new Error('invalid Date');
  return date.toISOString().slice(0, 10);
}

/** The placeholder for a number that does not exist yet. */
export const NO_VALUE = '—';
