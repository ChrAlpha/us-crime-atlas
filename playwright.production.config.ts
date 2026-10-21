import { defineConfig, devices } from '@playwright/test';

const BASE_PATH = '/us-crime-atlas/';
const PORT = 4174;

/**
 * Smoke-tests the production bundle exactly as GitHub Pages serves it: built for the
 * project subpath and served statically. The main suite runs against the dev server,
 * which resolves dependencies from node_modules and cannot catch missing build assets.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'production.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: [['line']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'production-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } } },
    { name: 'production-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: `pnpm run build && pnpm exec vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    env: { VITE_BASE_PATH: BASE_PATH },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
