/**
 * PM2 Ecosystem Configuration
 * 
 * Loads environment variables from .env file dynamically
 * This ensures .env is the single source of truth for all configurations
 */

const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

module.exports = {
  apps: [
    {
      name: 'imaps',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        // Read from .env, fallback to defaults
        NODE_ENV: process.env.NODE_ENV || 'production',
        NEXT_PUBLIC_ENVIRONMENT_PHASE: process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE || 'production',
        PORT: process.env.PORT || 3000,
        
        // Database
        DATABASE_URL: process.env.DATABASE_URL,
        
        // NextAuth
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        
        // API & Security
        ADMIN_SECRET: process.env.ADMIN_SECRET,
        API_KEY: process.env.API_KEY,
        
        // IP Whitelist
        IP_WHITELIST: process.env.IP_WHITELIST,
        IP_WHITELIST_ENABLED: process.env.IP_WHITELIST_ENABLED || 'false',
        
        // Logging & Timezone
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        APP_TIMEZONE: process.env.APP_TIMEZONE || 'WIB',
        
        // Rate Limiting
        RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED || 'true',
        RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || '1200',
        RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW || '60000',
        RATE_LIMIT_BURST: process.env.RATE_LIMIT_BURST || '200',
        
        // Cron Jobs
        ENABLE_JOBS: process.env.ENABLE_JOBS,
        CRON_RECALC_QUEUE_SCHEDULE: process.env.CRON_RECALC_QUEUE_SCHEDULE,
        CRON_DAILY_SNAPSHOT_SCHEDULE: process.env.CRON_DAILY_SNAPSHOT_SCHEDULE,
        
        // INSW Configuration
        INSW_API_KEY: process.env.INSW_API_KEY,
        INSW_UNIQUE_KEY_TEST: process.env.INSW_UNIQUE_KEY_TEST,
        INSW_UNIQUE_KEY_REAL: process.env.INSW_UNIQUE_KEY_REAL,
        INSW_USE_TEST_MODE: process.env.INSW_USE_TEST_MODE || 'false',
        
        // Additional
        ALLOW_FUTURE_DATES: process.env.ALLOW_FUTURE_DATES || 'false',
        SKIP_SEEDERS: process.env.SKIP_SEEDERS,
      },
      max_memory_restart: '512M',
      error_file: './logs/error.log',
      out_file: './logs/application.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    }
  ]
};
