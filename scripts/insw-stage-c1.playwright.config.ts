import { defineConfig } from '@playwright/test';
// Database-independent; no app, browser, setup, downloads or live worker.
export default defineConfig({ testDir: '../__tests__', testMatch: ['insw-stage-c1.spec.ts', 'insw-worker.stage-b.spec.ts'],
  workers: 1, retries: 0, timeout: 10000, reporter: 'list', outputDir: '/tmp/imaps-insw-stage-c1-results' });
