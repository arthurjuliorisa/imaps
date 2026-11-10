import { defineConfig } from '@playwright/test';
// In-memory doubles only. No webServer, browser, database setup or worker.
export default defineConfig({ testDir: '../__tests__', testMatch: [
  'insw-stage-a.spec.ts', 'insw-corrective-01.unit.spec.ts',
  'insw-worker.classification.spec.ts', 'insw-ui-detail.spec.ts',
], workers: 1, retries: 0, timeout: 30000, reporter: 'list', outputDir: '/tmp/imaps-insw-stage-a-results' });
