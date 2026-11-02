import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '../__tests__', testMatch: 'insw-ui-*.spec.ts', workers: 1,
  retries: 0, timeout: 90000, reporter: 'list', outputDir: '/tmp/imaps-insw-ui-remediation-results' });
