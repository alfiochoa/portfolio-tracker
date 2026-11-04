import { expect, it } from 'vitest';

it('refuses the network in unit tests', () => {
  expect(() => fetch('https://example.com')).toThrow(/disabled/);
});
