import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? 'html' : 'list',
  webServer: {
    command: 'npx vite --port 5199',
    port: 5199,
    reuseExistingServer: !isCI,
    timeout: 15000,
  },
  use: {
    baseURL: 'http://localhost:5199',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
