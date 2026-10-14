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
  // Old addresses keep working (checked in order; the first match wins). Query values are passed through.
  async redirects() {
    const old = '/:org(organisation|organization)';
    const department = { type: 'query', key: 'departmentId', value: '(?<departmentId>[0-9a-fA-F-]{36})' } as const;
    return [
      // Job titles moved under their department. /organization/job-titles/<id> is forwarded by its page, which looks
      // up the job title's department.
      { source: `${old}/job-titles`, has: [department], destination: '/organization/departments/:departmentId', permanent: true },
      { source: `${old}/job-titles`, destination: '/organization/departments', permanent: true },
      { source: `${old}/job-titles/new`, has: [department], destination: '/organization/departments/:departmentId/job-titles/new', permanent: true },
      { source: `${old}/job-titles/new`, destination: '/organization/departments', permanent: true },
      // The pages were at /organisation (British spelling) until October 2026.
      { source: '/organisation/:path*', destination: '/organization/:path*', permanent: true },
    ];
  },
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
