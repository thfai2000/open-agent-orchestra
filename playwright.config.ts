import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load .env so secrets like TESTING_GITHUB_PAT, TESTING_JIRA_API_TOKEN are
// available to the spec files (and to the helpers that provision agents with
// real Copilot credentials). Tests still skip themselves when these env vars
// are absent.
dotenv.config();

const auditMode = process.env.PLAYWRIGHT_AUDIT === '1';
const auditReportDir = process.env.OAO_TEST_REPORT_DIR ?? 'test-results/audit-report';

/**
 * Playwright configuration for OAO end-to-end tests.
 *
 * Target URL is configurable via E2E_BASE_URL (defaults to the locally-deployed
 * Nuxt UI on port 3002). When the target is not reachable, the smoke test
 * skips itself so the suite stays green in CI-less local workflows.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  workers: auditMode ? 1 : undefined,
  expect: { timeout: 10_000 },
  reporter: auditMode
    ? [
      ['list'],
      ['html', { outputFolder: `${auditReportDir}/playwright-html`, open: 'never' }],
      ['json', { outputFile: `${auditReportDir}/playwright-results.json` }],
    ]
    : [['list']],
  outputDir: auditMode ? `${auditReportDir}/playwright-artifacts` : 'test-results',
  retries: 0,
  forbidOnly: true,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://oao.local',
    trace: auditMode ? 'on' : 'retain-on-failure',
    screenshot: auditMode ? 'on' : 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--host-resolver-rules=MAP oao.local 127.0.0.1'],
        },
      },
    },
  ],
});
