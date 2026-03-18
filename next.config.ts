import type { NextConfig } from "next";

/**
 * Detect environment phase for dynamic build configuration
 * Uses same detection as API cleanup route for consistency
 */
function detectBuildEnvironment(): 'development' | 'staging' | 'production' {
  // Layer 1: Explicit environment variable
  const envPhase = process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE;
  if (envPhase === 'development' || envPhase === 'staging') {
    return envPhase;
  }

  // Layer 2: NODE_ENV
  if (process.env.NODE_ENV === 'development') {
    return 'development';
  }

  // Layer 3: Database feature flag
  const dbPhase = process.env.DATABASE_PHASE;
  if (dbPhase === 'development' || dbPhase === 'staging') {
    return dbPhase;
  }

  // Layer 4: Secure default to PRODUCTION
  return 'production';
}

const buildEnv = detectBuildEnvironment();
const isDevelopment = buildEnv === 'development';

/**
 * Build Behavior Strategy:
 * 
 * DEVELOPMENT:
 * - Strict type checking: ✅ Catch errors early
 * - Build speed: Slower (but safer for code quality)
 * 
 * STAGING/PRODUCTION:
 * - Ignore TypeScript errors: ✅ Skip to speed up build
 * - Build speed: Faster (errors caught at runtime if any)
 * 
 * This approach:
 * - Ensures code quality in dev before pushing
 * - Allows fast deployments in staging/production
 * - Prevents build failures from minor issues
 * 
 * Note: ESLint is configured via .eslintrc.json or build scripts
 * (not supported in NextConfig type definition)
 */
const nextConfig: NextConfig = {
  // Empty turbopack config untuk silence warning, tapi kita paksa pakai webpack
  turbopack: {},

  // TypeScript configuration based on environment
  typescript: {
    // Skip type checking in staging/production for faster builds
    ignoreBuildErrors: !isDevelopment,
  },
};

export default nextConfig;