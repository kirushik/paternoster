import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command: 'npx vite --port 5199',
    port: 5199,
    reuseExistingServer: true,
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:5199',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
