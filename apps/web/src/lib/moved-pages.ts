// The pages brought into Organization, the setup home (owner, 23 October 2026: "Check-in Setup, KPI Pillars and
// deadlines, Recruitment and checklists, Templates"), by their old address and their new one. next.config.ts redirects
// each old address, and every page under it, permanently (308) to the same place under the new one, with what follows
// kept (a template's slot, a department's id, a version's file) and the query passed through: a bookmark, a link in an
// old email or notification, or the Audit Log's links keep working. Redirected before any page or the proxy runs, so
// none of the old routes is left in the app. No imports: next.config.ts loads it.

export const MOVED_PAGES = [
  { from: '/templates', to: '/organization/templates' },
  { from: '/attendance/check-in-setup', to: '/organization/check-in-setup' },
  { from: '/kpis/pillars', to: '/organization/kpi-pillars' },
  { from: '/recruitment/settings', to: '/organization/recruitment' },
  { from: '/onboarding/checklist', to: '/organization/onboarding-checklist' },
  { from: '/offboarding/checklist', to: '/organization/clearance-checklist' },
] as const;

/** The redirects next.config.ts adds: `/old/:path*` matches the old page itself and every page under it. */
export function movedPagesRedirects(): { source: string; destination: string; permanent: true }[] {
  return MOVED_PAGES.map(({ from, to }) => ({ source: `${from}/:path*`, destination: `${to}/:path*`, permanent: true }));
}

/** Where an old address is now ("/templates/nda" → "/organization/templates/nda"); null for one that didn't move. */
export function movedTo(pathname: string): string | null {
  for (const { from, to } of MOVED_PAGES) {
    if (pathname === from || pathname.startsWith(`${from}/`)) return `${to}${pathname.slice(from.length)}`;
  }
  return null;
}
