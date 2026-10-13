import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Serve the self-contained pitch deck (public/pitch.html) at /pitch.
  async rewrites() {
    return [{ source: "/pitch", destination: "/pitch.html" }];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
