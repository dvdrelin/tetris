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
  // The suite talks to http://localhost:3001 (frontend) and http://localhost:3000 (backend).
  // They are started automatically; an already running dev server is reused.
  webServer: [
    {
      command: 'npm run dev:backend',
      port: 3000,
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'npm run dev:frontend',
      port: 3001,
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
  projects: [
    { name: 'frontend', testMatch: /.*\.test\.ts$/ }
  ],
});
