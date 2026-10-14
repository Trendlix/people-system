import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    // Files are uploaded through server actions: the company logo (up to 1 MB), scanned paperwork (up to 10 MB) and
    // the two national ID card photos read together (up to 10 MB each), plus room for the form's own bytes.
    serverActions: { bodySizeLimit: '25mb' },
    // proxy.ts runs on every request, and Next.js keeps only this much of a request body behind a proxy (10 MB by
    // default, cut off without an error), so it must be at least the server action limit.
    proxyClientMaxBodySize: '25mb',
  },
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
