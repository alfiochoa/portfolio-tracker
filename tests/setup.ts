// No unit test may touch the network (ARCHITECTURE.md, rule 2).
import { beforeEach } from 'vitest';

const refuse = (): never => {
  throw new Error('fetch is disabled in unit tests: use a literal fixture instead');
};

beforeEach(() => {
  globalThis.fetch = refuse as unknown as typeof fetch;
});
