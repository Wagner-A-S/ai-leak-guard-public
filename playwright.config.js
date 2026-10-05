import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  workers: 3,
  webServer: {
    command: 'node scripts/preview-server.mjs',
    url: 'http://127.0.0.1:8767/admin.html',
    reuseExistingServer: true,
    timeout: 10000,
  },
  use: {
    baseURL: 'http://127.0.0.1:8767',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  reporter: [['list']],
});
