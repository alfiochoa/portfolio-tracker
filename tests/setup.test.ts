import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

it('refuses the network in unit tests', () => {
  expect(() => fetch('https://example.com')).toThrow(/disabled/);
});

describe('the README', () => {
  const root = new URL('../', import.meta.url);
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const scripts = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).scripts as Record<string, string>;

  it('names only npm scripts that exist', () => {
    const named = [...readme.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1] as string);
    expect(named.length).toBeGreaterThan(4);
    for (const name of named) expect(scripts, `npm run ${name}`).toHaveProperty(name);
  });

  it('points at files that exist', () => {
    const files = [...readme.matchAll(/\]\((docs\/[\w./-]+?)(?:#[\w-]+)?\)/g)].map((m) => m[1] as string);
    const code = [...readme.matchAll(/`((?:scripts|data|public\/data)\/[\w./-]+)`/g)].map((m) => m[1] as string);
    expect(files.length).toBeGreaterThan(2);
    for (const f of [...files, ...code]) expect(existsSync(new URL(f, root)), f).toBe(true);
  });

  it('states each badge state and the import in three numbered lines', () => {
    for (const word of ['FRESH', 'STALE', 'PARTIAL', 'ERROR', 'run partial', 'run failed']) expect(readme).toContain('`' + word);
    const section = readme.split('## The allocation')[1]!.split('\n## ')[0]!;
    expect(section.match(/^\d\. /gm)).toHaveLength(3);
    expect(section).toContain('npm run import -- distribucion_agregada_cartera.xlsx');
  });
});
