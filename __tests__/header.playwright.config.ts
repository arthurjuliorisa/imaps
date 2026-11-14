import { defineConfig } from '@playwright/test';

// Offline only: no browser fixture, web server, session or database.
export default defineConfig({
  testDir: '.',
  testMatch: 'header-responsive.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '/tmp/imaps-header-offline-results',
});
