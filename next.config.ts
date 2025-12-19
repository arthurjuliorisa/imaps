import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empty turbopack config untuk silence warning, tapi kita paksa pakai webpack
  turbopack: {},
};

export default nextConfig;