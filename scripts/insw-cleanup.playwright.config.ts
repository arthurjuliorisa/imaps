import { defineConfig } from '@playwright/test';

// No web server or database: application dependencies and Sandbox calls are mocked.
export default defineConfig({
  testDir: '../__tests__',
  testMatch: ['insw-cleanup.spec.ts', 'insw-stage-c1.spec.ts', 'insw-queue.unit.spec.ts', 'insw-worker.unit.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: 'list',
  outputDir: '/tmp/imaps-insw-cleanup-test-results',
});
