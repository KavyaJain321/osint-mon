import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimized output for Render deployment
  output: "standalone",

  // Proxy API calls through Next.js to avoid CORS issues
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },

  // Suppress build warnings for known external packages
  serverExternalPackages: [],
};

export default nextConfig;
