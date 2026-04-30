import type { NextConfig } from "next";

function detectBuildEnvironment(): 'development' | 'staging' | 'production' {
  const envPhase = process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE;
  if (envPhase === 'development' || envPhase === 'staging') {
    return envPhase;
  }

  if (process.env.NODE_ENV === 'development') {
    return 'development';
  }

  const dbPhase = process.env.DATABASE_PHASE;
  if (dbPhase === 'development' || dbPhase === 'staging') {
    return dbPhase;
  }

  return 'production';
}

const buildEnv = detectBuildEnvironment();
const isDevelopment = buildEnv === 'development';

const nextConfig: NextConfig = {
  turbopack: {},
  
  typescript: {
    ignoreBuildErrors: !isDevelopment,
  },
  
  // Production optimizations
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  
  // Environment variables exposed to client
  env: {
    NEXT_PUBLIC_ENVIRONMENT_PHASE: process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  },
  
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;