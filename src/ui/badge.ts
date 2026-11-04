// The header: the name, the freshness badge, and the note on how funds are priced.
import { badgeText, type Freshness } from '../lib/freshness.ts';
import { h } from './dom.ts';

const SOURCE_NOTE = 'No price source yet: prices are fetched into a snapshot from M1 on (Yahoo Finance, unofficial).';

export function renderHeader(freshness: Freshness): HTMLElement {
  return h(
    'header',
    { class: 'site-header' },
    h('h1', { class: 'site-title' }, 'Portfolio tracker'),
    h('p', { class: 'badge', 'data-state': freshness.state, title: SOURCE_NOTE }, badgeText(freshness)),
    h('p', { class: 'header-note' }, 'Funds price once a day; the NAV of a day is published the next working day.'),
  );
}
