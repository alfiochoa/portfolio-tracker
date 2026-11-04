// The header: the name, the freshness badge, and the note on how funds are priced.
// The badge is a button: its text says the state in words, its dot and border in the state's
// colour (the --ok, --warn, --error tokens); hovering shows the detail as a tooltip, and a tap,
// a click or Enter opens it under the badge.
import type { Freshness } from '../lib/freshness.ts';
import { h } from './dom.ts';

const DETAIL_ID = 'badge-detail';

/** ISO dates and times stay whole: a line may wrap around them, never inside one. */
const WHOLE = /(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?: UTC)?)?)/;

function keepWhole(text: string): (Node | string)[] {
  return text.split(WHOLE).map((part, i) => (i % 2 === 1 ? h('span', { class: 'nowrap' }, part) : part));
}

/**
 * The badge's text in pieces that each stay on one line (`NAV as of …`, `snapshot …`, the states,
 * the run). Each ` ·` stays with the piece before it, so a line may end on a separator but never
 * starts with one; the text is the same.
 */
function pieces(freshness: Freshness): (Node | string)[] {
  const states = freshness.states.join(' · ');
  const run = freshness.run ? `run ${freshness.run}` : '';
  const tail = [states, run].filter(Boolean).join(' · ');
  const lead = tail ? freshness.text.slice(0, freshness.text.length - tail.length - ' · '.length) : freshness.text;
  const parts: (Node | string)[] = lead.split(' · ');
  // The dot rides with the first piece, so a line never starts or ends on it alone.
  parts[0] = h('span', {}, h('span', { class: 'badge-dot', 'aria-hidden': 'true' }), parts[0]!);
  if (states) parts.push(h('span', { class: 'badge-states' }, states));
  if (run) parts.push(h('span', { class: 'badge-states badge-run' }, run));
  const out: (Node | string)[] = [];
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    out.push(h('span', { class: 'nowrap' }, part, last ? null : ' ·'));
    if (!last) out.push(' ');
  });
  return out;
}

export function renderBadge(freshness: Freshness): HTMLElement {
  const detail = h(
    'ul',
    { id: DETAIL_ID, class: 'badge-detail', hidden: '' },
    ...freshness.details.map((line) => h('li', {}, ...keepWhole(line))),
  );
  const button = h(
    'button',
    {
      type: 'button',
      class: 'badge',
      'data-state': freshness.state,
      'data-tone': freshness.tone,
      title: freshness.details.join('\n'),
      'aria-expanded': 'false',
      'aria-controls': DETAIL_ID,
    },
    ...pieces(freshness),
  );
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    detail.hidden = !open;
  });
  return h('div', { class: 'badge-wrap' }, button, detail);
}

export function renderHeader(freshness: Freshness): HTMLElement {
  return h(
    'header',
    { class: 'site-header' },
    h('h1', { class: 'site-title' }, 'Portfolio tracker'),
    renderBadge(freshness),
    h('p', { class: 'header-note' }, 'Funds price once a day; the NAV of a day is published the next working day.'),
  );
}
