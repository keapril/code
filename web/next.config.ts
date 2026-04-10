import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare Pages 需要這個設定
  // Edge Runtime 在 Cloudflare 上執行，不需要 Node.js Server
};

export default nextConfig;
