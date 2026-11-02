import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '../__tests__', testMatch: 'insw-wms-log-status*.spec.ts', workers: 1,
  retries: 0, timeout: 60000, reporter: 'list', outputDir: '/tmp/imaps-insw-wms-log-status-results' });
