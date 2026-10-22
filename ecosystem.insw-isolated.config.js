// Separate, opt-in synthetic lab process. Never merge into production ecosystem.
module.exports = { apps: [{
  name: 'imaps-insw-isolated', script: 'scripts/insw-isolated-worker.ts',
  interpreter: 'node', interpreter_args: '--import tsx', cwd: __dirname,
  instances: 1, exec_mode: 'fork', autorestart: false, watch: false,
  // Exit/crash always requires stop/reap + audited recovery before next start.
  kill_timeout: 15000,
  env: { NODE_ENV: 'test', INSW_ISOLATED_WORKER_ENABLED: 'false' },
  env_isolated: { NODE_ENV: 'test', INSW_ISOLATED_WORKER_ENABLED: 'true' },
}] };
