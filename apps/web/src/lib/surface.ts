// Where a shared page or form is shown: the site (the pages with the sidebar) or the phone pages under /app, the
// employee app's pages (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? to enable
// them to check in and out, and apply for their requests"; apps/mobile/README.md, Phase 1). Both show the same pages'
// parts and send the same forms to the same server actions: a form shown in the phone pages carries the section it is in
// (a hidden field, components/surface.tsx), and the action, once done, opens the same request's page in that section
// rather than the site's. The phone pages' addresses are here too: they are the contract the app's shell and the later
// phases build on (README, Phase 1). Pure code, tested; no "@/" imports.

/** The sections of the phone pages whose forms send people on to a request's page: their own requests, and To approve. */
export const APP_SECTIONS = ['requests', 'approve'] as const;
export type AppSection = (typeof APP_SECTIONS)[number];

/** Where a shared page is shown: the site, or a section of the phone pages. */
export type Surface = 'site' | AppSection;

/** The hidden field a form carries in the phone pages: the section it is in. */
export const SURFACE_FIELD = 'surface';

export const isAppSection = (value: unknown): value is AppSection => (APP_SECTIONS as readonly unknown[]).includes(value);

/** The section of the phone pages a form was sent from; null for the site (no field, or a value it doesn't know). */
export function appSectionOf(fd: Pick<FormData, 'get'> | null | undefined): AppSection | null {
  const value = fd?.get(SURFACE_FIELD);
  return isAppSection(value) ? value : null;
}

// ---------- the phone pages' addresses ----------

/** The phone pages, each a tab or a page a tab opens. */
export const APP_PATHS = {
  home: '/app',
  requests: '/app/requests',
  newRequest: '/app/requests/new',
  newLeave: '/app/requests/new/leave',
  newPermission: '/app/requests/new/permission',
  newReimbursement: '/app/requests/new/reimbursement',
  newCorrection: '/app/requests/new/correction',
  newRaise: '/app/requests/new/raise',
  // a home location (owner, 20 October 2026: "allow other users to request to add their home locations when working from home")
  newHome: '/app/requests/new/home',
  // working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp")
  newWfh: '/app/requests/new/wfh',
  attendance: '/app/attendance',
  payslips: '/app/payslips',
  approve: '/app/approve',
} as const;

/**
 * The kinds of item a section opens: a request of the employee's, or one waiting for the caller (a pay raise: the CEO's).
 * A KPI scorecard (owner, 21 October 2026: "Self, manager, HR, sign-off"): the employee's to rate and sign under My
 * Requests, the manager's and HR's steps under To Approve.
 */
export const APP_ITEM_KINDS = ['leave', 'permission', 'reimbursement', 'correction', 'raise', 'pay-raise', 'home', 'kpi', 'wfh'] as const;
export type AppItemKind = (typeof APP_ITEM_KINDS)[number];

/** An item's page in a section: "/app/requests/leave/<id>", "/app/approve/reimbursement/<id>". */
export const appItemHref = (section: AppSection, kind: AppItemKind, id: string) => `/app/${section}/${kind}/${encodeURIComponent(id)}`;

/** The kinds of request the phone pages' My Requests lists, each a filter of it. */
export const APP_REQUEST_KINDS = ['leave', 'permission', 'reimbursement', 'correction', 'raise', 'home', 'wfh'] as const;
export type AppRequestKind = (typeof APP_REQUEST_KINDS)[number];

/** My Requests on the phone pages, of one kind and/or open ones only: "/app/requests?kind=leave&status=open". */
export function appRequestsHref(kind?: AppRequestKind | '' | null, status?: 'open' | '' | null): string {
  const params = new URLSearchParams();
  if (kind) params.set('kind', kind);
  if (status) params.set('status', status);
  const qs = params.toString();
  return qs ? `${APP_PATHS.requests}?${qs}` : APP_PATHS.requests;
}

/** A section's list: My Requests, or To approve. */
export const appSectionHref = (section: AppSection) => (section === 'requests' ? APP_PATHS.requests : APP_PATHS.approve);

/** Where a shared page's back link goes in a section, with its label (a page name, in Title Case). */
export function appBack(section: AppSection): { href: string; label: string } {
  return section === 'requests' ? { href: APP_PATHS.requests, label: 'My Requests' } : { href: APP_PATHS.approve, label: 'To Approve' };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month's attendance: "/app/attendance?month=2026-10"; this month's without one. */
export const appAttendanceHref = (month?: string | null) => (month && MONTH.test(month) ? `${APP_PATHS.attendance}?month=${month}` : APP_PATHS.attendance);

/** Asking to correct a day: "/app/requests/new/correction?date=2026-10-19"; the day chosen on the form without one. */
export const appCorrectionHref = (date?: string | null) => (date && DATE.test(date) ? `${APP_PATHS.newCorrection}?date=${date}` : APP_PATHS.newCorrection);

/** A raise request for someone (a manager's for a direct report): "/app/requests/new/raise?employee=<id>". */
export const appRaiseHref = (employeeId?: string | null) => (employeeId ? `${APP_PATHS.newRaise}?employee=${encodeURIComponent(employeeId)}` : APP_PATHS.newRaise);

/** A payslip's page (drawn in the page) and its PDF ("en" or "ar"; `download`: saved rather than opened). */
export const appPayslipHref = (lineId: string, language: 'en' | 'ar' = 'en') =>
  `${APP_PATHS.payslips}/${encodeURIComponent(lineId)}${language === 'ar' ? '?language=ar' : ''}`;
export const appPayslipPdfHref = (lineId: string, language: 'en' | 'ar', download = false) =>
  `${APP_PATHS.payslips}/${encodeURIComponent(lineId)}/${language}${download ? '?download=1' : ''}`;

// ---------- where an action sends someone on to ----------

const ID = '([0-9a-fA-F-]{36})';

/** The site's request pages and the kind of item each is in the phone pages, the more particular first. */
const ITEM_PAGES: readonly [RegExp, AppItemKind][] = [
  [new RegExp(`^/leave/permissions/${ID}$`), 'permission'],
  [new RegExp(`^/leave/${ID}$`), 'leave'],
  [new RegExp(`^/reimbursements/${ID}$`), 'reimbursement'],
  [new RegExp(`^/attendance/corrections/${ID}$`), 'correction'],
  [new RegExp(`^/home-locations/${ID}$`), 'home'],
  // a KPI scorecard (21 October 2026), also as the KPI notifications link it
  [new RegExp(`^/kpis/scorecards/${ID}$`), 'kpi'],
  // a work from home request (21 October 2026), also as its notifications link it
  [new RegExp(`^/attendance/wfh/${ID}$`), 'wfh'],
];

/** What an address says of what was just done, kept on the way: ?done= (decided, cancelled, moved on) and ?sent=. */
const KEPT_PARAMS = ['done', 'sent'] as const;

/**
 * A site address an action sends someone on to, as the phone pages' in `section`: a request's page as the same
 * request's page in the section, with what was just done kept (?done=moved); anything else (My Requests or Raise
 * Requests once a raise request is sent, Approvals once the CEO decides a raise) as the section's list, with ?done= or
 * ?sent= kept. The address's #part is left off (the phone pages have one list each).
 */
export function toAppHref(href: string, section: AppSection): string {
  const [pathAndQuery] = href.split('#');
  const at = pathAndQuery.indexOf('?');
  const path = at < 0 ? pathAndQuery : pathAndQuery.slice(0, at);
  const query = new URLSearchParams(at < 0 ? '' : pathAndQuery.slice(at + 1));
  const kept = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const value = query.get(key);
    if (value) kept.set(key, value);
  }
  const qs = kept.toString() ? `?${kept.toString()}` : '';
  for (const [pattern, kind] of ITEM_PAGES) {
    const m = pattern.exec(path);
    if (m) return `${appItemHref(section, kind, m[1])}${qs}`;
  }
  return `${appSectionHref(section)}${qs}`;
}

/** Where an action sends someone on to: the site's address, or, for a form sent from the phone pages, theirs. */
export function afterAction(fd: Pick<FormData, 'get'> | null | undefined, siteHref: string): string {
  const section = appSectionOf(fd);
  return section ? toAppHref(siteHref, section) : siteHref;
}
