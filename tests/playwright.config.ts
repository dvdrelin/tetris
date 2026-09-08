import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.test.ts',
  timeout: 30000,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retry-with-video',
  },
  retries: 0,
  workers: 1,
  projects: [
    { name: 'frontend', testMatch: /.*\.test\.ts$/ }
  ],
});
