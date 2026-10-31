import type { Role } from '@trendlix/shared';

// The API's documentation (owner, 31 October 2026: "Use Swagger to make apis documentation … We have application,
// Website, Admin panel. Each one is a separated link on the swagger base /app /web and so on. Each link has its own
// page which display the components. Each components refer to a module with its endpoints"; asked, he chose "App /
// Website / Admin"): which page each endpoint is on. Pure, tested (docs.spec.ts):
// - app: what the Flutter app (apps/flutter) calls, listed below; a test keeps the list in step with the app's code;
// - admin: what only HR, Finance, the CEO, an Admin, a Super Admin or a developer may call (its @Roles), and the
//   integrations that aren't a person's (webhooks, the careers site's key, the connector);
// - web: what any signed-in employee or manager may call on the website (no @Roles, or one naming an employee or a
//   manager), and the sign-in's public endpoints.
// An endpoint on two (the app's and the website's own month, say) is on both pages.

export const DOC_AUDIENCES = ['app', 'web', 'admin'] as const;
export type DocAudience = (typeof DOC_AUDIENCES)[number];

/** Each page's title and what it is for. */
export const DOC_AUDIENCE_INFO: Record<DocAudience, { title: string; description: string }> = {
  app: {
    title: 'People System API · Mobile app',
    description:
      'The endpoints the Trendlix People app (Flutter, Android) calls, by module: signing in (password, then the fingerprint), checking in and out, the requests, attendance, the profile, KPIs, assets and notifications. The app sends its session as `Authorization: Bearer <token>`.',
  },
  web: {
    title: 'People System API · Website',
    description:
      'The endpoints the People website (people.trendlix.com) calls for every employee and manager, by module. The website’s server sends the session as `Authorization: Bearer <token>`; the API’s own sign-in also sets the `ps_session` cookie.',
  },
  admin: {
    title: 'People System API · Admin panel',
    description:
      'The endpoints of the website’s HR, Finance, CEO and settings pages, by module: only HR, Finance, the CEO, Admins, Super Admins or developers may call them (each says who). Also the integrations that aren’t a person’s: webhooks, the careers site and the connector.',
  },
};

/** The roles of the admin panel: an endpoint limited to these is the admin panel's. */
export const ADMIN_ROLES: readonly Role[] = ['hr', 'finance', 'ceo', 'admin', 'super_admin', 'developer'];

/**
 * What the app calls (apps/flutter/lib, 31 October 2026), as "METHOD /api/path" with `{x}` for a path parameter; `*`
 * for any method. Kept in step with the app by docs.spec.ts (every '/api/…' the app's code names is matched here).
 */
export const APP_ENDPOINTS: readonly string[] = [
  // signing in and the account
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/auth/me',
  'POST /api/auth/change-password',
  'POST /api/auth/forgot-password',
  'POST /api/auth/email-code',
  'POST /api/auth/email-code/sign-in',
  'GET /api/auth/devices',
  'POST /api/auth/devices',
  'POST /api/auth/devices/sign-in',
  'POST /api/auth/devices/{x}/revoke',
  'GET /api/auth/sessions',
  // whether the app is the newest build (its force update, 31 October 2026)
  'GET /api/app/latest',
  'POST /api/auth/sessions/{x}/end',
  // checking in and attendance
  'GET /api/me/attendance/today',
  'POST /api/me/attendance/punches',
  'GET /api/attendance/me',
  'GET /api/me/attendance/corrections',
  'POST /api/me/attendance/corrections',
  'POST /api/me/attendance/corrections/{x}/cancel',
  'GET /api/attendance/corrections/{x}',
  'GET /api/payroll/holidays',
  // requests
  'GET /api/leave/types',
  'GET /api/me/leave/balances',
  'GET /api/me/leave/coverage',
  // each kind: one's list and a new one, its page, and cancelling (withdrawing) it from one's own list's path
  '* /api/me/leave/requests',
  'POST /api/me/leave/requests/{x}/cancel',
  'GET /api/leave/requests/{x}',
  '* /api/me/permissions',
  'GET /api/me/permissions/allowance',
  'POST /api/me/permissions/{x}/cancel',
  'GET /api/leave/permissions/{x}',
  '* /api/me/wfh',
  'GET /api/me/wfh/allowance',
  'POST /api/me/wfh/{x}/cancel',
  'GET /api/wfh/{x}',
  '* /api/me/official-duty',
  'GET /api/me/official-duty/form',
  'POST /api/me/official-duty/{x}/cancel',
  'GET /api/official-duty/{x}',
  '* /api/me/compensatory',
  'GET /api/me/compensatory/form',
  'POST /api/me/compensatory/{x}/cancel',
  'GET /api/compensatory/{x}',
  '* /api/me/home-locations',
  'POST /api/me/home-locations/{x}/withdraw',
  'GET /api/home-locations/{x}',
  '* /api/me/reimbursements',
  'GET /api/me/reimbursement-types',
  'POST /api/me/reimbursements/{x}/cancel',
  'GET /api/reimbursements/{x}',
  '* /api/me/resignation',
  'POST /api/me/resignation/{x}/withdraw',
  'GET /api/resignation-requests/{x}',
  // the profile
  'GET /api/employees/{x}',
  'POST /api/employees/{x}/change-requests',
  'POST /api/change-requests/{x}/cancel',
  'GET /api/calendars/mine',
  '* /api/me/interview-hours',
  'GET /api/me/custody',
  // KPIs
  'GET /api/kpis/settings',
  'GET /api/kpis/counts',
  'GET /api/kpis/heatmap',
  'GET /api/kpis/scorecards',
  'GET /api/kpis/scorecards/mine',
  'GET /api/kpis/scorecards/waiting',
  'GET /api/kpis/scorecards/{x}',
  '* /api/kpis/scorecards/{x}/self',
  '* /api/kpis/scorecards/{x}/score',
  '* /api/kpis/scorecards/{x}/sign',
  // notifications
  'GET /api/me/notifications',
  'GET /api/me/notifications/unread-count',
  'POST /api/me/notifications/read-all',
];

/**
 * The integrations that aren't a person's: the admin panel's page, though no @Roles guards them (WhatsApp's webhooks,
 * the Claude connector). The public pages' own (the careers pages, an offer's link, setting a password) are the
 * website's.
 */
export const INTEGRATION_MODULES: readonly string[] = ['WhatsAppModule', 'ConnectorModule'];
const INTEGRATION_PATHS = [/^\/api\/public\/whatsapp\//, /webhook/];

/** A path with its parameters as `{x}`: "/api/leave/requests/{id}" → "/api/leave/requests/{x}". */
export const pathShape = (path: string) => path.replace(/\{[^}]+\}/g, '{x}');

/** Whether the app calls this endpoint (APP_ENDPOINTS). */
export function appCalls(method: string, path: string, list: readonly string[] = APP_ENDPOINTS): boolean {
  const shape = pathShape(path);
  return list.some((entry) => {
    const [m, p] = entry.split(' ');
    return p === shape && (m === '*' || m.toUpperCase() === method.toUpperCase());
  });
}

/** What the docs know of an endpoint: its method and path (OpenAPI's, `{id}`), its module, its roles, public or not. */
export interface EndpointFacts {
  method: string;
  path: string;
  module: string;
  roles: readonly Role[] | null;
  isPublic: boolean;
}

/** The pages an endpoint is on (DOC_AUDIENCES' order). */
export function audiencesOf(e: EndpointFacts): DocAudience[] {
  const out = new Set<DocAudience>();
  if (appCalls(e.method, e.path)) out.add('app');
  const integration = INTEGRATION_MODULES.includes(e.module) || INTEGRATION_PATHS.some((re) => re.test(e.path));
  if (integration) out.add('admin');
  else if (e.roles && e.roles.length && e.roles.every((r) => ADMIN_ROLES.includes(r))) out.add('admin');
  else out.add('web');
  return DOC_AUDIENCES.filter((a) => out.has(a));
}

/** A module's name as its section says it: "ZohoPeopleModule" → "Zoho People". */
const MODULE_NAMES: Record<string, string> = {
  KpisModule: 'KPIs',
  WfhModule: 'Work from home',
  OdModule: 'Official duty',
  AuthModule: 'Sign-in and sessions',
  OrganisationModule: 'Organisation',
  AuditLogModule: 'Audit log',
  PayrollLockedChangesModule: 'Payroll: locked changes',
  PayrollAdjustmentsModule: 'Payroll: adjustments',
  PayrollStatisticsModule: 'Payroll: statistics',
  SocialInsuranceReportModule: 'Payroll: social insurance report',
  LawRatesModule: 'Payroll: law rates',
  UnsettledModule: 'Payroll: unsettled',
  WhatsAppModule: 'WhatsApp',
  PdfModule: 'PDF',
  ZohoPeopleModule: 'Zoho People',
  AppModule: 'System',
};
export function moduleLabel(moduleName: string): string {
  if (MODULE_NAMES[moduleName]) return MODULE_NAMES[moduleName];
  const words = moduleName.replace(/Module$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0) + words.slice(1).toLowerCase();
}
