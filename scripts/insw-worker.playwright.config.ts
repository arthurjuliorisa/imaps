import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../__tests__', testMatch: 'insw-worker.*.spec.ts', workers: 1,
  retries: 0, timeout: 10000, reporter: 'list', outputDir: '/tmp/imaps-insw-worker-test-results',
});
