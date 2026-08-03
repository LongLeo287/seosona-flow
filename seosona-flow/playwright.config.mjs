// P2.T6 — Playwright config for extension E2E. Serialized, artifact-retaining.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/test/phase-02/e2e-report.json' }],
  ],
  outputDir: 'artifacts/test/phase-02/e2e-output',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
