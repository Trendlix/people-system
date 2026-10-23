import type { NextConfig } from "next";
import { movedPagesRedirects } from "./src/lib/moved-pages";

/** The sites that may show the careers pages in a frame: the company's own website. */
const CAREERS_FRAMED_BY = ['https://www.trendlix.com', 'https://trendlix.com'];

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
  // The Claude connector's sign-in and consent page (owner, 21 October 2026: "the connection method") is never shown in
  // another site's frame (no clickjacking of Allow), and its address (the OAuth request) is never sent on as a referrer.
  // The careers pages may be shown in a frame on trendlix.com, and only there (owner, 22 October 2026: "i will put it in
  // the main website"): at /careers, and on the careers address once it has one (careers.trendlix.com, whose every page
  // is a careers page: lib/public-paths.ts careersRewrite). The headers are matched before that rewrite, hence the host
  // rule.
  async headers() {
    const careersFrame = [{ key: 'Content-Security-Policy', value: `frame-ancestors 'self' ${CAREERS_FRAMED_BY.join(' ')}` }];
    return [
      // every other page (the staff site, the phone pages, the public offer page) only in its own frames (the labels and
      // forms printed from a frame), never on another site: no clickjacking (22 October 2026). Not on the careers pages,
      // nor the careers address, nor /oauth, which set their own below.
      {
        source: '/:path((?!careers(?:/|$)|oauth(?:/|$)).*)',
        missing: [{ type: 'host', value: 'careers\\..+' }],
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      { source: '/careers', headers: careersFrame },
      { source: '/careers/:path*', headers: careersFrame },
      { source: '/:path*', has: [{ type: 'host', value: 'careers\\..+' }], headers: careersFrame },
      {
        source: '/oauth/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
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
      // The Salary Raises report moved under Payroll → Reports (owner, 17 October 2026: "Reports (Statistics)" under
      // Payroll); its workbook with it. The period asked for (?from=&to=) is passed through.
      { source: '/employees/raises', destination: '/payroll/reports/salary-raises', permanent: true },
      { source: '/employees/raises/excel', destination: '/payroll/reports/salary-raises/excel', permanent: true },
      // The pages brought into Organization's setup menu (owner, 23 October 2026: "Check-in Setup, KPI Pillars and
      // deadlines, Recruitment and checklists, Templates", their old links redirecting): each old page and every page
      // under it, e.g. /templates/<slot> and /kpis/pillars/<department> (src/lib/moved-pages.ts).
      ...movedPagesRedirects(),
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
