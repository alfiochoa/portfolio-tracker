/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

const port = Number(process.env.TEAM_PORT ?? 5200);

export default defineConfig({
  // Relative asset URLs, as market-desk: the same build works at http://localhost:<port>/ and under
  // GitHub Pages' project sub-path (https://<user>.github.io/portfolio-tracker/).
  base: './',
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
