import { defineConfig } from '@playwright/test';
// Deterministic mocks only. No server, PostgreSQL or provider is started.
export default defineConfig({ testDir: '../__tests__', testMatch: 'insw-post-restore.spec.ts', workers: 1,
  retries: 0, reporter: 'list', outputDir: '/tmp/imaps-insw-post-restore-results' });
