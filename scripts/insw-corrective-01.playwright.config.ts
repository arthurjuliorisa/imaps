import { defineConfig } from '@playwright/test';

// Explicit files only; no webServer, browser, worker process, DB setup or HTTP.
export default defineConfig({
  testDir: '../__tests__', testMatch: 'insw-corrective-01.*.spec.ts',
  workers: 1, retries: 0, timeout: 30000, reporter: 'list',
  outputDir: '/tmp/imaps-insw-corrective-01-results',
});
