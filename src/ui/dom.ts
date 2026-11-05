// A small element builder: text goes in as text (never innerHTML), attributes as strings.

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined) el.setAttribute(name, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/**
 * A section card with a heading that names it, so it is a landmark (`region`) with that name. The
 * head is the title and an optional aside at its right (docs/DESIGN.md "Card and section head").
 */
export function section(id: string, title: string, aside: string | null, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { id, class: `section section-${id}`, 'aria-labelledby': `${id}-title` },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: `${id}-title`, class: 'section-title' }, title),
      aside ? h('span', { class: 'section-aside' }, aside) : null,
    ),
    ...children,
  );
}

/** The quiet note a section shows when it has nothing to show yet. */
export function placeholder(...children: Child[]): HTMLElement {
  return h('p', { class: 'placeholder' }, ...children);
}

/** The error a section shows instead of its content: a lead ("No returns") on its own line, then why. */
export function errorPlaceholder(lead: string, text: string): HTMLElement {
  return h('p', { class: 'placeholder placeholder-error' }, h('strong', { class: 'placeholder-lead' }, lead), ' ', text);
}

/** `npm run snapshots` and the like, as code inside a sentence. */
export const code = (text: string): HTMLElement => h('code', {}, text);
