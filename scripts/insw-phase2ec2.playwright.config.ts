import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '../__tests__', testMatch: 'insw-phase2ec2.spec.ts', workers: 1,
  retries: 0, timeout: 60000, reporter: 'list', outputDir: '/tmp/imaps-insw-phase2ec2-results' });
