import { defineConfig } from '@playwright/test';

process.env.ALLOWED_ORIGINS = 'http://localhost';

// Hermetic suites only: no webServer, database, provider or process supervisor.
export default defineConfig({
  testDir: '../__tests__',
  testMatch: ['insw-fixed-recovery-host.spec.ts', 'insw-worker-recovery.spec.ts', 'insw-settings.spec.ts', 'insw-settings-ui.spec.ts',
    'insw-cleanup.spec.ts', 'insw-stage-c1.spec.ts', 'insw-queue.unit.spec.ts', 'insw-worker.unit.spec.ts'],
  workers: 1, retries: 0, timeout: 60000, reporter: 'list',
  outputDir: '/tmp/imaps-insw-worker-recovery-results',
});
