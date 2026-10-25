// Separate from the unchanged Next.js process. Loading this file never opts in.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
module.exports = { apps: [{
  name: 'imaps-insw-worker', script: 'scripts/insw-worker.ts', cwd: __dirname,
  interpreter: 'node', interpreter_args: '--import tsx',
  instances: 1, exec_mode: 'fork', autorestart: false, watch: false,
  // Retained sticky owner requires audited reap/recovery on EVERY restart.
  kill_timeout: 75000,
  env: { NODE_ENV: 'production', INSW_WORKER_ENABLED: process.env.INSW_WORKER_ENABLED === 'true' ? 'true' : 'false' },
  error_file: './logs/insw-worker-error.log', out_file: './logs/insw-worker.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
}] };
