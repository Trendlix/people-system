import { REFUSED_ACTION, REFUSED_MESSAGE_MAX, REFUSED_STATUSES, type AuditModule } from '@trendlix/shared';
import type { AuditEntry } from './audit.service.js';

// What a signed-in person tried and was refused (owner, 31 October 2026: "Also log what someone tried and was refused
// (no permission, a locked month, a rule broken)"; as the Trendlix website logs a save refused for the admin's role): a
// change (POST, PUT, PATCH, DELETE) answered 400, 403, 404, 409 or 422, written to the log as 'refused' on its module,
// with the method, the address's pattern (/api/leave/requests/:id/approve, never the ids in it), the answer's status and
// its message. Never what was sent. Not a request with no one signed in (public pages, signing in, webhooks), not a
// 401 (signed out) or a 5xx (the server's fault, not a refusal), and not the log's own addresses. Pure: tested.

const MUTATIONS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The addresses never recorded: the log's own, signing in and out, the public ones, the connector's sign-in, the docs. */
const NOT_RECORDED = [
  '/api/audit',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/email-code',
  '/api/auth/devices/sign-in',
  '/api/auth/forgot-password',
  '/api/auth/password-link',
  '/api/public',
  '/api/connector/oauth',
  '/api/docs',
];

/** Whether an answer is a refusal to record (above). */
export function isRecordedRefusal(method: string, status: number, path: string | null): boolean {
  if (!MUTATIONS.has(method.toUpperCase()) || !REFUSED_STATUSES.includes(status) || !path) return false;
  return !NOT_RECORDED.some((p) => path === p || path.startsWith(`${p}/`));
}

/** The module of an address, by its pattern after /api/ (':' for each parameter); the first that matches wins. */
const PATH_MODULES: readonly (readonly [prefix: string, module: AuditModule])[] = [
  ['me/attendance', 'attendance'],
  ['me/wfh', 'attendance'],
  ['me/official-duty', 'attendance'],
  ['me/home-locations', 'attendance'],
  ['me/leave', 'leave'],
  ['me/permissions', 'leave'],
  ['me/compensatory', 'leave'],
  ['me/payslips', 'payroll'],
  ['me/custody', 'assets'],
  ['me/resignation', 'lifecycle'],
  ['me/interview-hours', 'recruitment'],
  ['me/whatsapp', 'settings'],
  ['me', 'employees'],
  ['employees/:/check-in-exemptions', 'attendance'],
  ['employees/:/check-in-places', 'attendance'],
  ['employees/:/leave', 'leave'],
  ['employees/:/permissions', 'leave'],
  ['employees/:/payslips', 'payroll'],
  ['employees/:/employments/:/endings', 'lifecycle'],
  ['employees', 'employees'],
  ['contracts', 'employees'],
  ['contract-settings', 'employees'],
  ['raises', 'employees'],
  ['change-requests', 'employees'],
  ['paperwork', 'employees'],
  ['departments', 'organisation'],
  ['job-titles', 'organisation'],
  ['grades', 'organisation'],
  ['company', 'organisation'],
  ['org-chart', 'organisation'],
  ['documents', 'documents'],
  ['templates', 'documents'],
  ['id-card', 'documents'],
  ['payroll/holidays', 'attendance'],
  ['attendance', 'attendance'],
  ['shifts', 'attendance'],
  ['home-locations', 'attendance'],
  ['wfh', 'attendance'],
  ['official-duty', 'attendance'],
  ['zoho-people', 'attendance'],
  ['leave', 'leave'],
  ['compensatory', 'leave'],
  ['payroll', 'payroll'],
  ['allowance-types', 'payroll'],
  ['client-accounts', 'payroll'],
  ['reimbursements', 'reimbursements'],
  ['reimbursement-types', 'reimbursements'],
  ['kpis', 'kpis'],
  ['assets', 'assets'],
  ['recruitment', 'recruitment'],
  ['offers', 'recruitment'],
  ['calendars', 'recruitment'],
  ['meetings', 'recruitment'],
  ['interview-hours', 'recruitment'],
  ['onboarding', 'lifecycle'],
  ['offboarding', 'lifecycle'],
  ['resignation-requests', 'lifecycle'],
  ['endings', 'lifecycle'],
  ['ending-rules', 'lifecycle'],
  ['users', 'access'],
  ['auth', 'access'],
  ['connector', 'access'],
  ['mail-settings', 'settings'],
  ['maps-settings', 'settings'],
  ['maps', 'settings'],
  ['whatsapp', 'settings'],
];

/** An address pattern's parts after /api/, each parameter as ':'. */
const partsOf = (path: string): string[] =>
  path
    .replace(/^\/?api\//, '')
    .split('/')
    .filter(Boolean)
    .map((p) => (p.startsWith(':') ? ':' : p));

/** The module an address belongs to; 'other' for one not listed (reports, the version …). */
export function moduleOfPath(path: string): AuditModule {
  const parts = partsOf(path);
  for (const [prefix, module] of PATH_MODULES) {
    const wanted = prefix.split('/');
    if (wanted.every((w, i) => parts[i] === w)) return module;
  }
  return 'other';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The answer's message as the person read it (a list joined), cut to REFUSED_MESSAGE_MAX; null when it has none. */
export function refusalMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const m = (body as { message?: unknown }).message;
  const text = Array.isArray(m) ? m.filter((x) => typeof x === 'string').join(' ') : typeof m === 'string' ? m : '';
  const t = text.trim();
  return t ? (t.length > REFUSED_MESSAGE_MAX ? `${t.slice(0, REFUSED_MESSAGE_MAX - 1)}…` : t) : null;
}

/** The entry for a refused attempt by `userId`: on its module, on the record its :id names when that is an id. */
export function refusedEntry(userId: string, method: string, path: string, status: number, params: Record<string, unknown> | undefined, body: unknown): AuditEntry {
  const id = params?.id;
  return {
    userId,
    action: REFUSED_ACTION,
    entityType: moduleOfPath(path),
    entityId: typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null,
    diff: { method: method.toUpperCase(), path, status, message: refusalMessage(body) },
  };
}
