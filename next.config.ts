import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {},
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
