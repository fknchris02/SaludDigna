import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: [
    "http://10.0.2.2:3000",
    "http://10.0.2.2",
    "10.0.2.2",
    "10.0.2.2:3000",
    "localhost",
    "localhost:3000",
    "http://localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "http://127.0.0.1:3000",
    "10.35.10.109",
    "10.35.10.109:3000",
    "http://10.35.10.109:3000"
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
