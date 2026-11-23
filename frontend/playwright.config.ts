import { defineConfig, devices } from '@playwright/test';
import { APP_URL, AUTH_STATE } from './e2e/support/env';

/**
 * End-to-end tests against the running dev stack (see e2e/README.md).
 * One worker: every spec uses the same teacher account and the solve endpoint is
 * rate-limited (10/hour), so tests run serially and share seeded, pre-solved cohorts.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]],
  outputDir: 'e2e/.results',
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 1000 },
    launchOptions: process.env.E2E_LD_LIBRARY_PATH
      // For hosts missing Chromium's system libs without sudo (see README).
      ? { env: { ...process.env, LD_LIBRARY_PATH: process.env.E2E_LD_LIBRARY_PATH } as Record<string, string> }
      : {},
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/, teardown: 'teardown' },
    { name: 'teardown', testMatch: /global\.teardown\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1000 }, storageState: AUTH_STATE },
    },
  ],
});
