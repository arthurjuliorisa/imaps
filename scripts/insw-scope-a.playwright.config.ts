import { defineConfig } from '@playwright/test';
// Source and in-memory boundary tests only. No runtime services or database.
process.env.ALLOWED_ORIGINS = 'http://localhost';
export default defineConfig({ testDir: '../__tests__', testMatch: [
  'insw-scope-a.spec.ts', 'insw-scope-a-monitoring-ui.spec.ts', 'insw-settings.spec.ts', 'insw-settings-ui.spec.ts', 'insw-ui-refresh.spec.ts', 'insw-ui-permissions.spec.ts',
], workers: 1, retries: 0, timeout: 30000, reporter: 'list', outputDir: '/tmp/imaps-insw-scope-a-results' });
