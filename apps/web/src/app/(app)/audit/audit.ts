import { isAuditModule, isAuditResult, isSignInOutcome, type AuditModule, type AuditResult, type Role, type SignInOutcome } from '@trendlix/shared';
import { AUDIT_LOG_PATH } from '../../../components/nav';
import { formatDate, parseDate } from '../../../lib/format';
import { googleMapsHref } from '../../../lib/map-point';
import { hasRole } from '../../../lib/roles';
import { shownCode, withCode } from '../../../lib/hidden';

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

/**
 * Where an entry came from (owner, 31 October 2026: "with location and ip capture"): the visitor's address (none when
 * not known, or only the host's own), the place ("Cairo, Egypt", from the website's host), the browser or app in a few
 * words ("Chrome 141 on macOS"), and the phone's position from the app ("Yes, with each sign-in and action").
 */
export interface AuditFrom {
  ip: string | null;
  /** 'website': signed by the website; 'connection': the connection's own (the app's, or not signed). */
  ipSource: 'website' | 'connection' | null;
  place: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  userAgent: string | null;
  browser: string | null;
  location: { latitude: number; longitude: number; accuracyMetres: number | null; mock: boolean } | null;
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
  /** Done, or refused (owner, 31 October 2026: "a Result column, Succeeded or Refused, with the reason"). */
  result: AuditResult;
  resultLabel: string;
  /** The part of the system ("Module filter"); null for a kind of record with none. */
  module: AuditModule | null;
  moduleLabel: string | null;
  from: AuditFrom;
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
  /** 31 October 2026; an API from before sends none. */
  modules?: { value: string; label: string }[];
  results?: { value: string; label: string }[];
  outcomes?: { value: string; label: string }[];
}

/** A sign-in as GET /audit/sign-ins answers it (owner, 31 October 2026: "Every sign-in in its own tab"). */
export interface SignInEntry {
  id: string;
  at: string;
  when: string;
  email: string | null;
  user: AuditPerson | null;
  outcome: SignInOutcome;
  outcomeLabel: string;
  /** Went through (green), or refused (red). */
  ok: boolean;
  method: string | null;
  methodLabel: string | null;
  kind: string | null;
  action: string;
  from: AuditFrom;
}

export interface SignInsPage {
  entries: SignInEntry[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
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
  /** Text in what changed, or the address or city it came from. */
  q: string;
  /** The part of the system (31 October 2026). */
  module: AuditModule | '';
  /** Succeeded or refused (31 October 2026). */
  result: AuditResult | '';
  /** The page, 1 for the newest. */
  page: number;
}

export const NO_FILTERS: AuditFilters = { from: '', to: '', user: '', action: '', type: '', record: '', employee: '', q: '', module: '', result: '', page: 1 };

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
    module: isAuditModule(one(query.module)) ? (one(query.module) as AuditModule) : '',
    result: isAuditResult(one(query.result)) ? (one(query.result) as AuditResult) : '',
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
  set('module', f.module);
  set('result', f.result);
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
  set('module', f.module);
  set('result', f.result);
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

/**
 * The same filters on the API's query as the Excel route passes them on: the web's names read back from its address;
 * the Sign-ins tab's (?tab=sign-ins) to its own export.
 */
export function apiExportPathOf(search: URLSearchParams): string {
  const query: Query = Object.fromEntries(search.entries());
  if (readTab(query) === 'sign-ins') return apiSignInsExportPath(readSignInFilters(query).filters);
  return apiExportPath(readAuditFilters(query).filters);
}

// ---------- the tabs ----------

/** The page's two tabs (owner, 31 October 2026: "Every sign-in in its own tab"): every entry, and the sign-ins. */
export type AuditTab = 'activity' | 'sign-ins';

export const readTab = (query: Query): AuditTab => (one(query.tab) === 'sign-ins' ? 'sign-ins' : 'activity');

// ---------- the Sign-ins tab's filters ----------

/** The Sign-ins tab's filters (owner: "with its own filters"): the days, the outcome, text in the email, address or browser. */
export interface SignInFilters {
  from: string;
  to: string;
  outcome: SignInOutcome | '';
  q: string;
  page: number;
}

export const NO_SIGN_IN_FILTERS: SignInFilters = { from: '', to: '', outcome: '', q: '', page: 1 };

/** The Sign-ins tab's filters in the address, and what was wrong with any (left out then). */
export function readSignInFilters(query: Query): { filters: SignInFilters; problems: string[] } {
  const problems: string[] = [];
  const from = dayOf(one(query.from));
  const to = dayOf(one(query.to));
  if (from === null) problems.push('Enter the first day as DD/MM/YYYY, e.g. 01/10/2026.');
  if (to === null) problems.push('Enter the last day as DD/MM/YYYY, e.g. 31/10/2026.');
  const page = Number(one(query.page));
  const outcome = one(query.outcome);
  const filters: SignInFilters = {
    from: from ?? '',
    to: to ?? '',
    outcome: isSignInOutcome(outcome) ? outcome : '',
    q: one(query.q).slice(0, 200),
    page: Number.isInteger(page) && page > 1 ? Math.min(page, 100000) : 1,
  };
  if (filters.from && filters.to && filters.from > filters.to) {
    problems.push('Choose a first day on or before the last day.');
    filters.to = '';
  }
  return { filters, problems };
}

export const isSignInFiltered = (f: SignInFilters) => !!(f.from || f.to || f.outcome || f.q);

function signInParams(f: SignInFilters, page: number, web: boolean): URLSearchParams {
  const params = new URLSearchParams();
  if (web) params.set('tab', 'sign-ins');
  for (const key of ['from', 'to', 'outcome', 'q'] as const) if (f[key]) params.set(key, f[key]);
  if (page > 1) params.set('page', String(page));
  return params;
}

/** GET /audit/sign-ins with the filters and the page. */
export const apiSignInsPath = (f: SignInFilters) => withQuery('/audit/sign-ins', signInParams(f, f.page, false));

/** GET /audit/sign-ins/export with the filters. */
export const apiSignInsExportPath = (f: SignInFilters) => withQuery('/audit/sign-ins/export', signInParams(f, 1, false));

/** The Sign-ins tab's address with these filters, on `page`. */
export const signInsHref = (f: SignInFilters, page = 1) => withQuery(AUDIT_PATH, signInParams(f, page, true));

/** The Sign-ins tab's Excel export, served under the web domain (excel/route.ts). */
export const signInsExcelHref = (f: SignInFilters) => withQuery(`${AUDIT_PATH}/excel`, signInParams(f, 1, true));

/** The Sign-ins tab's filters in words: "From 01/10/2026 · Wrong password · “41.33”". */
export function signInFiltersText(f: SignInFilters, options: AuditOptions | null): string {
  const parts: string[] = [];
  if (f.from) parts.push(`From ${formatDate(f.from)}`);
  if (f.to) parts.push(`to ${formatDate(f.to)}`);
  if (f.outcome) parts.push(options?.outcomes?.find((o) => o.value === f.outcome)?.label ?? f.outcome);
  if (f.q) parts.push(`“${f.q}”`);
  return parts.join(' · ');
}

// ---------- where it came from, in words ----------

/** The address, or a dash; with how it was known, for its tooltip. */
export const ipText = (from: AuditFrom | undefined) => from?.ip ?? '—';

export const ipTitle = (from: AuditFrom | undefined): string | undefined =>
  from?.ip ? (from.ipSource === 'website' ? 'The visitor’s address, as the website saw it' : 'The connection’s own address') : undefined;

/**
 * Where it was, in words: the phone's position from the app ("Phone location ±12 m", with its map, flagged when the
 * phone said it was made up); else the place the website's host named ("Cairo, Egypt"); else a dash.
 */
export function placeOf(from: AuditFrom | undefined): { text: string; href: string | null; mock: boolean } {
  const l = from?.location;
  if (l) return { text: `Phone location${l.accuracyMetres !== null ? ` ±${l.accuracyMetres.toLocaleString('en-US')} m` : ''}`, href: googleMapsHref(l), mock: l.mock };
  return { text: from?.place ?? '—', href: null, mock: false };
}

/** The browser or app in a few words, or a dash. */
export const browserText = (from: AuditFrom | undefined) => from?.browser ?? '—';

// ---------- the entries in words ----------

const count = (n: number) => n.toLocaleString('en-US');

/** "1 entry", "1,234 entries". */
export const entriesLabel = (n: number) => `${count(n)} ${n === 1 ? 'entry' : 'entries'}`;

/** "1 sign-in", "1,234 sign-ins". */
export const signInsLabel = (n: number) => `${count(n)} ${n === 1 ? 'sign-in' : 'sign-ins'}`;

/** Where the page is: "Entries 51–100 of 1,234"; "No entries" when none match. */
export function rangeText(p: Pick<AuditPage, 'page' | 'pageSize' | 'total'> & { entries: readonly unknown[] }): string {
  if (p.total === 0 || p.entries.length === 0) return 'No entries';
  const first = (p.page - 1) * p.pageSize + 1;
  const last = first + p.entries.length - 1;
  return `Entries ${count(first)}–${count(last)} of ${count(p.total)}`;
}

/** The changes from → to, and the values given (on a create, or naming what it is about), apart. */
export function splitChanges(changes: readonly AuditChange[]): { changed: AuditChange[]; values: AuditChange[] } {
  return { changed: changes.filter((c) => c.kind === 'change'), values: changes.filter((c) => c.kind === 'value') };
}

/**
 * Which fields a change changed, in a few words (as the Trendlix website's log sums up a save: "title, cover image"):
 * "Gross salary, Status, Grade and 2 more"; empty when it changed none (a create, a look).
 */
export function changedFieldsText(changes: readonly AuditChange[], most = 3): string {
  const labels = changes.filter((c) => c.kind === 'change').map((c) => c.label);
  if (labels.length <= most + 1) return labels.join(', ');
  return `${labels.slice(0, most).join(', ')} and ${labels.length - most} more`;
}

/**
 * Why a refused entry was refused, as the person was told, and what was tried ("POST /api/departments → 403"): from a
 * refused attempt's own lines (31 October 2026), else a refusal's reason; null for an entry that went through.
 */
export function refusalOf(entry: Pick<AuditEntry, 'result' | 'changes'>): { why: string | null; tried: string | null } | null {
  if (entry.result !== 'refused') return null;
  const value = (field: string) => entry.changes.find((c) => c.field === field && !c.masked)?.to ?? null;
  const method = value('method');
  const path = value('path');
  const status = value('status');
  return { why: value('message') ?? value('reason'), tried: method && path ? `${method} ${path}${status ? ` → ${status}` : ''}` : null };
}

/** A restricted value as the log has it: "Changed, not shown", "Set, not shown". */
export const maskedText = (masked: 'changed' | 'set') => (masked === 'changed' ? 'Changed, not shown' : 'Set, not shown');

/** A value, or a dash for none. */
export const shown = (value: string | null) => value ?? '—';

/** The record in words: "Contract CON-2026-0007", "Payroll run October 2026", "Employee" (a developer's: no person code). */
export const recordText = (e: Pick<AuditEntry, 'entityLabel' | 'reference'>) => (shownCode(e.reference) ? `${e.entityLabel} ${e.reference}` : e.entityLabel);

/** A user as the Who list names them: "Mona Hassan · mona@trendlix.com", "finance@trendlix.com (inactive)". */
export function userOptionLabel(u: AuditPerson & { active: boolean }): string {
  const label = u.name ? `${u.name} · ${u.email}` : u.email;
  return u.active ? label : `${label} (inactive)`;
}

/** An employee as the Employee list names them: "Mona Hassan · EMP-0007" (a developer's: the tag alone). */
export const employeeOptionLabel = (e: AuditEmployee) => withCode(e.fullNameEn, e.employeeCode);

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
  if (f.module) parts.push(options?.modules?.find((m) => m.value === f.module)?.label ?? f.module);
  if (f.result) parts.push(options?.results?.find((r) => r.value === f.result)?.label ?? f.result);
  if (f.q) parts.push(`“${f.q}”`);
  return parts.join(' · ');
}
