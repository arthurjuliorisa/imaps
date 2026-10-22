import { defineConfig } from '@playwright/test';

// Foundation tests have no browser, web server, application imports or HTTP calls.
export default defineConfig({
  testDir: '../__tests__',
  testMatch: 'insw-queue.*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: 'list',
  outputDir: '/tmp/imaps-insw-queue-test-results',
});
