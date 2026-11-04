import { defineConfig } from '@playwright/test';

const port = Number(process.env.TEAM_PORT ?? 5200);
const baseURL = `http://localhost:${port}`;

const sizes = {
  phone: { width: 360, height: 740 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1280, height: 800 },
} as const;
const themes = ['light', 'dark'] as const;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL,
    browserName: 'chromium',
    // Chromium's sandbox stays on (CLAUDE.md): Playwright turns it off unless told.
    launchOptions: { chromiumSandbox: true },
  },
  projects: Object.entries(sizes).flatMap(([size, viewport]) =>
    themes.map((colorScheme) => ({ name: `${size}-${colorScheme}`, use: { viewport, colorScheme } })),
  ),
  // The built site (run `npm run build` first), served by vite preview on this agent's port.
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
