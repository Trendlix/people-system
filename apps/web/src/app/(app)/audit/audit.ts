import type { Role } from '@trendlix/shared';
import { AUDIT_LOG_PATH } from '../../../components/nav';
import { formatDate, parseDate } from '../../../lib/format';
import { hasRole } from '../../../lib/roles';

// The Audit Log (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): every change in the
// system, who made it and when, for the Super Admin and the CEO; also an employee's History, from their profile. Plain
// helpers for the page (no server-only, so they are unit tested): who sees it, the filters read from the address and the
// links that keep them, and the entries' parts in words. The API shapes each entry (apps/api/src/audit/audit-view.ts)
// and checks the roles again. Relative imports: the tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

/** The page's address (the sidebar's Audit Log). */
export const AUDIT_PATH = AUDIT_LOG_PATH;

/** Who reads the log: the Super Admin and the CEO (owner, 19 October 2026), who see everyone, C-level people too. */
export const AUDIT_ROLES: readonly Role[] = ['super_admin', 'ceo'];

export const canSeeAuditLog = (user: WithRoles) => hasRole(user, ...AUDIT_ROLES);

/** Only these may open every profile, so only they get a link from the log to the person's profile. */
export const opensProfiles = (user: WithRoles) => hasRole(user, 'hr', 'ceo', 'finance');

// ---------- what the API answers (GET /audit, GET /audit/options) ----------

export interface AuditPerson {
  id: string;
  email: string;
  /** The name on the employee profile whose work email it is; null when none. */
  name: string | null;
}

export interface AuditEmployee {
  id: string;
  employeeCode: string;
  fullNameEn: string;
}

export interface AuditChange {
  field: string;
  label: string;
  /** change: from → to; value: a value alone, in `to`. */
  kind: 'change' | 'value';
  from: string | null;
  to: string | null;
  /** Restricted: written to the log only as changed or set, never the value. */
  masked: 'changed' | 'set' | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  /** "19/10/2026, 5:42 PM", Cairo time. */
  when: string;
  who: { text: string; user: AuditPerson | null; by: AuditPerson | null };
  action: string;
  actionLabel: string;
  entityType: string;
  entityLabel: string;
  entityId: string | null;
  reference: string | null;
  employee: AuditEmployee | null;
  link: { href: string; label: string } | null;
  changes: AuditChange[];
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  next: string | null;
}

export interface AuditOptions {
  users: (AuditPerson & { active: boolean })[];
  actions: { value: string; label: string }[];
  entityTypes: { value: string; label: string }[];
  employees: AuditEmployee[];
}

// ---------- the filters, in the address ----------

/** The filters as the page reads them from its address; the days as YYYY-MM-DD. */
export interface AuditFilters {
  from: string;
  to: string;
  /** Who did it: a user's id. */
  user: string;
  action: string;
  /** The kind of record (entityType). */
  type: string;
  /** One record, by its id (entityId). */
  record: string;
  /** Everything about one person: an employee's id. */
  employee: string;
  /** Text in what changed. */
  q: string;
  /** The page, 1 for the newest. */
  page: number;
}

export const NO_FILTERS: AuditFilters = { from: '', to: '', user: '', action: '', type: '', record: '', employee: '', q: '', page: 1 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z_]{0,63}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');

/** A day from the address: as typed in the date field (DD/MM/YYYY) or as the links write it (YYYY-MM-DD); null when it isn't one. */
function dayOf(value: string): string | null {
  if (!value) return '';
  if (ISO_DAY.test(value)) return parseDate(formatDate(value)) === value ? value : null;
  return parseDate(value);
}

/**
 * The filters in the address, and what was wrong with any (left out then, so the page still shows the rest): a day that
 * isn't one, a first day after the last, an id or a choice that isn't one.
 */
export function readAuditFilters(query: Query): { filters: AuditFilters; problems: string[] } {
  const problems: string[] = [];
  const from = dayOf(one(query.from));
  const to = dayOf(one(query.to));
  if (from === null) problems.push('Enter the first day as DD/MM/YYYY, e.g. 01/10/2026.');
  if (to === null) problems.push('Enter the last day as DD/MM/YYYY, e.g. 31/10/2026.');
  const id = (key: string, what: string) => {
    const v = one(query[key]);
    if (v && !UUID.test(v)) problems.push(what);
    return v && UUID.test(v) ? v.toLowerCase() : '';
  };
  const key = (k: string) => {
    const v = one(query[k]);
    return KEY.test(v) ? v : '';
  };
  const page = Number(one(query.page));
  const filters: AuditFilters = {
    from: from ?? '',
    to: to ?? '',
    user: id('user', 'Choose who did it from the list.'),
    action: key('action'),
    type: key('type'),
    record: id('record', 'Enter the record’s id as the system writes it, e.g. 0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e.'),
    employee: id('employee', 'Choose the employee from the list.'),
    q: one(query.q).slice(0, 200),
    page: Number.isInteger(page) && page > 1 ? Math.min(page, 100000) : 1,
  };
  if (filters.from && filters.to && filters.from > filters.to) {
    problems.push('Choose a first day on or before the last day.');
    filters.to = '';
  }
  return { filters, problems };
}

/** Whether any filter is set (the page aside). */
export const isFiltered = (f: AuditFilters) => Object.entries(f).some(([k, v]) => k !== 'page' && v !== '');

/** The filters as the API's query: ?from=&to=&userId=&action=&entityType=&entityId=&employeeId=&q=&page= (only those set). */
function apiQuery(f: AuditFilters, withPage: boolean): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => {
    if (value) params.set(key, value);
  };
  set('from', f.from);
  set('to', f.to);
  set('userId', f.user);
  set('action', f.action);
  set('entityType', f.type);
  set('entityId', f.record);
  set('employeeId', f.employee);
  set('q', f.q);
  if (withPage && f.page > 1) params.set('page', String(f.page));
  return params;
}

const withQuery = (path: string, params: URLSearchParams) => {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};

/** GET /audit with the filters and the page. */
export const apiAuditPath = (f: AuditFilters) => withQuery('/audit', apiQuery(f, true));

/** GET /audit/export with the filters (every page, up to the API's 10,000). */
export const apiExportPath = (f: AuditFilters) => withQuery('/audit/export', apiQuery(f, false));

/** The page's address with these filters, on `page` (the first unless said). */
export function auditHref(f: AuditFilters, page = 1): string {
  const params = new URLSearchParams();
  const set = (key: keyof AuditFilters, value: string) => {
    if (value) params.set(key, value);
  };
  set('from', f.from);
  set('to', f.to);
  set('user', f.user);
  set('action', f.action);
  set('type', f.type);
  set('record', f.record);
  set('employee', f.employee);
  set('q', f.q);
  if (page > 1) params.set('page', String(page));
  return withQuery(AUDIT_PATH, params);
}

/** The Excel export with the page's filters, served under the web domain (excel/route.ts). */
export const auditExcelHref = (f: AuditFilters) => {
  const href = auditHref({ ...f, page: 1 });
  return href === AUDIT_PATH ? `${AUDIT_PATH}/excel` : href.replace(`${AUDIT_PATH}?`, `${AUDIT_PATH}/excel?`);
};

/** An employee's History: the log filtered to everything about them (the profile's History link). */
export const historyHref = (employeeId: string) => auditHref({ ...NO_FILTERS, employee: employeeId });

/** The same filters on the API's query as the Excel route passes them on: the web's names read back from its address. */
export function apiExportPathOf(search: URLSearchParams): string {
  const query: Query = Object.fromEntries(search.entries());
  return apiExportPath(readAuditFilters(query).filters);
}

// ---------- the entries in words ----------

const count = (n: number) => n.toLocaleString('en-US');

/** "1 entry", "1,234 entries". */
export const entriesLabel = (n: number) => `${count(n)} ${n === 1 ? 'entry' : 'entries'}`;

/** Where the page is: "Entries 51–100 of 1,234"; "No entries" when none match. */
export function rangeText(p: Pick<AuditPage, 'page' | 'pageSize' | 'total' | 'entries'>): string {
  if (p.total === 0 || p.entries.length === 0) return 'No entries';
  const first = (p.page - 1) * p.pageSize + 1;
  const last = first + p.entries.length - 1;
  return `Entries ${count(first)}–${count(last)} of ${count(p.total)}`;
}

/** The changes from → to, and the values given (on a create, or naming what it is about), apart. */
export function splitChanges(changes: readonly AuditChange[]): { changed: AuditChange[]; values: AuditChange[] } {
  return { changed: changes.filter((c) => c.kind === 'change'), values: changes.filter((c) => c.kind === 'value') };
}

/** A restricted value as the log has it: "Changed, not shown", "Set, not shown". */
export const maskedText = (masked: 'changed' | 'set') => (masked === 'changed' ? 'Changed, not shown' : 'Set, not shown');

/** A value, or a dash for none. */
export const shown = (value: string | null) => value ?? '—';

/** The record in words: "Contract CON-2026-0007", "Payroll run October 2026", "Employee". */
export const recordText = (e: Pick<AuditEntry, 'entityLabel' | 'reference'>) => (e.reference ? `${e.entityLabel} ${e.reference}` : e.entityLabel);

/** A user as the Who list names them: "Mona Hassan · mona@trendlix.com", "finance@trendlix.com (inactive)". */
export function userOptionLabel(u: AuditPerson & { active: boolean }): string {
  const label = u.name ? `${u.name} · ${u.email}` : u.email;
  return u.active ? label : `${label} (inactive)`;
}

/** An employee as the Employee list names them: "Mona Hassan · EMP-0007". */
export const employeeOptionLabel = (e: AuditEmployee) => `${e.fullNameEn} · ${e.employeeCode}`;

/** The filters in words for the heading over the entries: "From 01/10/2026 · Updated · Contract"; empty when none. */
export function filtersText(f: AuditFilters, options: AuditOptions | null): string {
  const parts: string[] = [];
  if (f.from) parts.push(`From ${formatDate(f.from)}`);
  if (f.to) parts.push(`to ${formatDate(f.to)}`);
  if (f.user) {
    const u = options?.users.find((x) => x.id === f.user);
    parts.push(`by ${u ? (u.name ?? u.email) : 'one user'}`);
  }
  if (f.action) parts.push(options?.actions.find((a) => a.value === f.action)?.label ?? f.action);
  if (f.type) parts.push(options?.entityTypes.find((t) => t.value === f.type)?.label ?? f.type);
  if (f.record) parts.push('one record');
  if (f.q) parts.push(`“${f.q}”`);
  return parts.join(' · ');
}
