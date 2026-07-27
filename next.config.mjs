/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output → lean production Docker image (server.js + minimal deps).
  output: "standalone",
  // Pin the workspace root (a package-lock.json also exists in the home dir).
  outputFileTracingRoot: import.meta.dirname,
  images: {
    // Amazon product images are served from these CDNs.
    remotePatterns: [
      { protocol: "https", hostname: "*.media-amazon.com" },
      { protocol: "https", hostname: "*.ssl-images-amazon.com" },
      { protocol: "https", hostname: "m.media-amazon.com" },
    ],
  },
};

export default nextConfig;
