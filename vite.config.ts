/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

const port = Number(process.env.TEAM_PORT ?? 5200);

export default defineConfig({
  // One page, no client routing: a missing file answers 404 (as a static host does), not index.html.
  appType: 'mpa',
  server: { port, strictPort: true },
  preview: { port, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
