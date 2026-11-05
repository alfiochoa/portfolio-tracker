// The view control: Glance (the default) or Desk, two looks of the same page (docs/DESIGN.md "Views").
// The choice is `data-view="desk"` on <html> (none for Glance) and is remembered in localStorage;
// index.html's first-paint script reads it before the stylesheet paints, so a Desk user never sees
// Glance flash. Storage that throws is ignored: the browser just forgets.
import { h } from './dom.ts';

export const VIEW_KEY = 'portfolio-tracker.view';
export type View = 'glance' | 'desk';
const VIEWS: readonly [View, string][] = [
  ['glance', 'Glance'],
  ['desk', 'Desk'],
];

export function currentView(): View {
  return document.documentElement.dataset.view === 'desk' ? 'desk' : 'glance';
}

function setView(view: View): void {
  if (view === 'desk') document.documentElement.dataset.view = 'desk';
  else delete document.documentElement.dataset.view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // A browser that refuses storage: the choice lasts until the page is closed.
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('.view-switch button')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  }
}

export function renderViewSwitch(): HTMLElement {
  const now = currentView();
  return h(
    'div',
    { class: 'view-switch', role: 'group', 'aria-label': 'View' },
    ...VIEWS.map(([view, label]) => {
      const button = h('button', { type: 'button', 'data-view': view, 'aria-pressed': String(view === now) }, label);
      // The chosen segment ignores a click: it is already the view. Focus and scroll stay where they are.
      button.addEventListener('click', () => {
        if (currentView() !== view) setView(view);
      });
      return button;
    }),
  );
}
