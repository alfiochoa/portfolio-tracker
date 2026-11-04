// A small element builder: text goes in as text (never innerHTML), attributes as strings.

type Child = Node | string | null | undefined | false;

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

/** A section with a heading that names it, so it is a landmark (`region`) with that name. */
export function section(id: string, title: string, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { id, class: `section section-${id}`, 'aria-labelledby': `${id}-title` },
    h('h2', { id: `${id}-title`, class: 'section-title' }, title),
    ...children,
  );
}

/** The quiet note a section shows when it has nothing to show yet. */
export function placeholder(text: string): HTMLElement {
  return h('p', { class: 'placeholder' }, text);
}
