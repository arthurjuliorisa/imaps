import { defineConfig } from '@playwright/test';
// Synthetic request origin, scoped to this test runner (including production-mode runs).
process.env.ALLOWED_ORIGINS = 'http://localhost';
export default defineConfig({ testDir: '../__tests__', testMatch: 'insw-settings*.spec.ts', workers: 1,
  retries: 0, timeout: 30000, reporter: 'list', outputDir: '/tmp/imaps-insw-settings-results' });
