import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel-optimized settings
  serverExternalPackages: ["@slack/web-api"],
};

export default nextConfig;
