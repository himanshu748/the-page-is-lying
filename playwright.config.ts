import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'static/ui/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --config static/ui/vite.config.e2e.ts',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
