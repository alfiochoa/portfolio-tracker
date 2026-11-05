// The euro total (SPEC "The screen", docs/DESIGN.md "Euro total (M2)"): the line at the bottom of
// the performance card, the one-field form behind it, and the pair of functions that keep the total
// in this browser's localStorage and nowhere else (ARCHITECTURE rule 8). Every storage call is inside
// try/catch: a private window or blocked storage means no euros, never an error.
//
// The page re-renders by replacing #app's children (src/main.ts), on a return to the tab too. So
// what the form holds lives here, not in the DOM: whether it is open, what is typed, the error.
// A re-render draws the form again with the draft, and gives the field its focus back when it had it.
import type { Euros, StoredTotal } from '../lib/euros.ts';
import { parseEuros, parseStoredTotal } from '../lib/euros.ts';
import { formatEuros } from '../lib/format.ts';
import { h } from './dom.ts';

export const TOTAL_KEY = 'portfolio-tracker.total';
const INPUT_ID = 'euro-input';
const ERROR_ID = 'euro-error';
const NOTE_ID = 'euro-note';

export interface StoredRead {
  /** The total kept in this browser, or null. */
  total: StoredTotal | null;
  /** False when the browser refuses storage (reading it threw). */
  available: boolean;
}

/** The kept total. A value that does not parse to a positive whole number and an ISO date is removed. */
export function readStoredTotal(): StoredRead {
  let text: string | null;
  try {
    text = localStorage.getItem(TOTAL_KEY);
  } catch {
    return { total: null, available: false };
  }
  const total = parseStoredTotal(text);
  if (text !== null && total === null) forgetStoredTotal();
  return { total, available: true };
}

/** Keep `total`; false when the browser would not. */
export function writeStoredTotal(total: StoredTotal): boolean {
  try {
    localStorage.setItem(TOTAL_KEY, JSON.stringify({ euros: total.euros, asOf: total.asOf }));
    return true;
  } catch {
    return false;
  }
}

export function forgetStoredTotal(): void {
  try {
    localStorage.removeItem(TOTAL_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

const INVALID = 'Type a whole number of euros, like 25000.';
const NOT_KEPT = 'This browser is not keeping anything for this page (a private window, or storage blocked), so the amount cannot be kept here.';

/** The form's state, across re-renders. */
const ui = {
  open: false,
  draft: '',
  error: null as string | null,
  /** Where focus goes once the next render is in the page. */
  focus: null as 'input' | 'line' | null,
};

/** Call before a re-render: notes whether the field has focus, so afterRender gives it back. */
export function beforeRender(): void {
  if (ui.open && document.activeElement?.id === INPUT_ID) ui.focus ??= 'input';
}

/** Call once the render is in the page: moves focus where the last action left it. */
export function afterRender(): void {
  const focus = ui.focus;
  ui.focus = null;
  if (focus === 'input') document.getElementById(INPUT_ID)?.focus();
  else if (focus === 'line') document.querySelector<HTMLElement>('.euro button')?.focus();
}

function linkButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'link-button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

export interface TotalLineInput {
  stored: StoredRead;
  /** The amounts for the stored total, or null when none is stored. */
  euros: Euros | null;
  /** L, the badge's latest date: a total saved now is taken as the value on it. */
  latest: string;
  /** Draws the page again from what it already has (no fetch). */
  rerender: () => void;
}

function form({ stored, latest, rerender }: TotalLineInput): HTMLElement {
  const invalid = ui.error !== null;
  const input = h('input', {
    id: INPUT_ID,
    type: 'number',
    min: '1',
    step: '1',
    inputmode: 'numeric',
    autocomplete: 'off',
    'aria-invalid': invalid ? 'true' : undefined,
    'aria-describedby': invalid ? `${ERROR_ID} ${NOTE_ID}` : NOTE_ID,
  });
  input.value = ui.draft;
  input.addEventListener('input', () => {
    ui.draft = input.value;
  });
  const cancel = linkButton('Cancel', () => {
    ui.open = false;
    ui.error = null;
    ui.focus = 'line';
    rerender();
  });
  const el = h(
    'form',
    { class: 'euro-form', novalidate: '' },
    h('label', { for: INPUT_ID, class: 'euro-label' }, "Your portfolio's total value today, in whole euros"),
    h('span', { class: 'euro-field', 'data-invalid': invalid ? 'true' : undefined }, input, h('span', { class: 'euro-unit', 'aria-hidden': 'true' }, '€')),
    invalid ? h('p', { id: ERROR_ID, class: 'euro-error', role: 'alert' }, ui.error) : null,
    h('div', { class: 'euro-actions' }, h('button', { type: 'submit', class: 'button-primary' }, 'Show amounts'), cancel),
    h('p', { id: NOTE_ID, class: 'euro-note' }, stored.available ? 'Stays in this browser. It is never sent anywhere or saved with the project.' : NOT_KEPT),
  );
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    ui.draft = input.value;
    const euros = input.validity.badInput ? null : parseEuros(input.value);
    if (euros === null) ui.error = INVALID;
    else if (!writeStoredTotal({ euros, asOf: latest })) ui.error = NOT_KEPT;
    else {
      ui.open = false;
      ui.error = null;
      ui.draft = '';
      ui.focus = 'line';
      rerender();
      return;
    }
    ui.focus = 'input';
    rerender();
  });
  return el;
}

/** The line under the tiles: the link, the form, the worth with Change and Forget, or why there are no amounts. */
export function renderTotalLine(input: TotalLineInput): HTMLElement {
  const { stored, euros, rerender } = input;
  if (ui.open) return h('div', { class: 'euro', 'data-state': 'form' }, form(input));

  const openForm = (draft: string) => () => {
    ui.open = true;
    ui.draft = draft;
    ui.error = null;
    ui.focus = 'input';
    rerender();
  };
  if (!stored.total || !euros) {
    return h('div', { class: 'euro', 'data-state': 'none' }, linkButton('Show amounts in euros', openForm('')));
  }

  const entered = stored.total;
  const actions = h(
    'span',
    { class: 'euro-actions' },
    linkButton('Change', openForm(String(entered.euros))),
    linkButton('Forget', () => {
      forgetStoredTotal();
      ui.focus = 'line';
      rerender();
    }),
  );
  const typed = h('span', { class: 'num' }, formatEuros(entered.euros, 'value'));

  if (euros.kind === 'not-in-series') {
    const why = euros.older ? 'is older than these prices' : 'is not one of the dates these prices have';
    return h(
      'div',
      { class: 'euro', 'data-state': 'not-carried' },
      h(
        'p',
        { class: 'euro-warn' },
        h('strong', {}, 'The ', typed),
        ` you entered for ${entered.asOf} ${why}, so no amounts are shown. Type today's total to see them again.`,
      ),
      actions,
    );
  }

  const worth = h('strong', { class: 'euro-worth-value num' }, formatEuros(euros.worth, 'value'));
  const from = entered.asOf === euros.latest ? [', the amount you entered. '] : [', from the ', typed, ` you entered for ${entered.asOf}; assumes nothing added or withdrawn since. `];
  return h('div', { class: 'euro', 'data-state': 'stored' }, h('p', { class: 'euro-worth' }, 'Worth ', worth, ` on ${euros.latest}`, ...from, actions));
}
