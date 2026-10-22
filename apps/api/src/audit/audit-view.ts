import { AUDIT_VIA_CONNECTOR, type Role } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import { monthName } from '../payroll/months.js';
import { actionLabel, entityLabel, fieldLabel } from './audit-labels.js';

// An audit_log entry shaped for reading on the Audit Log page and in its Excel export (owner, 19 October 2026: "an
// Audit Log page showing who changed what and when"): who did it (a Super Admin viewing as someone: "Super Admin X as
// Y"), when, the action and the record in words, the person it is about, where the record is in the system when it still
// is and the caller can open that page, and the diff as from → to pairs. Pure: the service reads what the entries name
// from the database (AuditRefs) and passes it in. The values the services masked before writing them ("changed" or
// "set": the national ID, bank account, wages …) stay masked: they are shown as changed or set, never looked up.

/** An audit_log row as the list query reads it. */
export interface AuditRow {
  id: bigint | string;
  userId: string | null;
  onBehalfById: string | null;
  /** 'claude_connector': done through the Claude connector (21 October 2026); null or left out otherwise. */
  via?: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff: unknown;
  at: Date;
}

/** A sign-in account: its email, and the name of the employee whose work email it is, if any. */
export interface AuditPerson {
  id: string;
  email: string;
  name: string | null;
}

/** An employee as an entry names them. */
export interface AuditEmployee {
  id: string;
  employeeCode: string;
  fullNameEn: string;
}

/** A record an entry names, as the database has it now (none in AuditRefs: deleted since, or a kind not looked up). */
export interface AuditRecord {
  /** The person it belongs to. */
  employeeId?: string | null;
  /** Its own words: a contract's or an offer's number, a run's month, a department's name … */
  reference?: string | null;
  /** The payroll run it is on (a payroll line, an attendance import). */
  runId?: string | null;
  /** The record it is part of: a leave document's request, a receipt's claim. */
  parentId?: string | null;
  /** A template version's slot. */
  slot?: string | null;
}

/** What the entries of a page name, read from the database by the service. */
export interface AuditRefs {
  users: ReadonlyMap<string, AuditPerson>;
  employees: ReadonlyMap<string, AuditEmployee>;
  employeesByCode: ReadonlyMap<string, AuditEmployee>;
  /** By recordKey(entityType, entityId). */
  records: ReadonlyMap<string, AuditRecord>;
  /** Any id met in a diff → its name: people, accounts, departments, job titles, grades, shifts, payroll runs … */
  names: ReadonlyMap<string, string>;
}

export const recordKey = (entityType: string, entityId: string) => `${entityType}:${entityId}`;

/** One line of an entry's changes: a field from → to, or a value given (on a create, or what the entry is about). */
export interface AuditChange {
  /** Its path in the diff: "grossSalary", "bank.accountNo". */
  field: string;
  /** In words: "Gross salary", "Bank · Account number". */
  label: string;
  /** "change": from → to; "value": a value alone, in `to`. */
  kind: 'change' | 'value';
  from: string | null;
  to: string | null;
  /** Restricted, written to the log only as "changed" or "set" (never the value): null when the value is shown. */
  masked: 'changed' | 'set' | null;
}

/** The entry as GET /audit answers it. */
export interface AuditEntryView {
  /** audit_log.id, as text (a bigint). */
  id: string;
  /** ISO moment. */
  at: string;
  /** In Cairo, as the screens write it: "19/10/2026, 5:42 PM". */
  when: string;
  who: {
    /** "Mona Hassan", "hr@trendlix.com", "System", "Super Admin Hazem Magdy as Mona Hassan". */
    text: string;
    user: AuditPerson | null;
    /** The Super Admin who did it viewing as `user` (audit_log.on_behalf_by), or null. */
    by: AuditPerson | null;
    /** 'claude_connector': the user's own Claude did it through the connector (audit_log.via); null otherwise. */
    via: 'claude_connector' | null;
  };
  action: string;
  actionLabel: string;
  entityType: string;
  entityLabel: string;
  entityId: string | null;
  /** The record's own words: "CON-2026-0007", "October 2026", "Engineering"; null when nothing names it. */
  reference: string | null;
  /** The person the entry is about, when it is about one. */
  employee: AuditEmployee | null;
  /** Where the record is in the system, for a caller who can open that page; null when none or deleted since. */
  link: { href: string; label: string } | null;
  changes: AuditChange[];
}

// ---------- values ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_TEXT = 300;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

const CAIRO = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** A moment in Cairo, as every screen writes it: "19/10/2026, 5:42 PM" (DD/MM/YYYY and 12-hour time). */
export function shownMoment(moment: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes) => CAIRO.formatToParts(moment).find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`;
}

const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);

/** A plain object (not an array, a date or null). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A change as the services write it: { from, to }, either one alone or both. */
function isPair(value: unknown): value is { from?: unknown; to?: unknown } {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => k === 'from' || k === 'to');
}

/** "changed" / "set": a restricted value the service wrote to the log only as the fact that it changed, or was given. */
const maskOf = (value: unknown): 'changed' | 'set' | null => (value === 'changed' || value === 'set' ? value : null);

/**
 * A value as the page shows it: dates as DD/MM/YYYY, moments in Cairo with 12-hour times, months by name, yes or no,
 * an id the page knows by its name (`names`), long text cut short; null for no value.
 */
export function valueText(value: unknown, names: ReadonlyMap<string, string> = new Map()): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'string') {
    if (UUID.test(value)) return names.get(value.toLowerCase()) ?? value;
    if (DAY.test(value)) return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
    if (MOMENT.test(value)) {
      const moment = new Date(value);
      return Number.isNaN(moment.getTime()) ? clip(value) : shownMoment(moment);
    }
    if (MONTH.test(value)) return monthName(value);
    return clip(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return 'None';
    if (value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) {
      return clip(value.map((v) => valueText(v, names) ?? '—').join(', '));
    }
    return clip(JSON.stringify(value));
  }
  return clip(JSON.stringify(value));
}

/**
 * The diff as lines: each { from, to } a change, each "changed" or "set" a masked one, each nested group (bank,
 * identity) its fields under its name, anything else a value. In the diff's own order.
 */
export function changesOf(diff: unknown, names: ReadonlyMap<string, string> = new Map()): AuditChange[] {
  if (diff === null || diff === undefined) return [];
  if (!isObject(diff)) return [{ field: 'details', label: 'Details', kind: 'value', from: null, to: valueText(diff, names), masked: null }];
  const out: AuditChange[] = [];
  const walk = (obj: Record<string, unknown>, path: string[]) => {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;
      const at = [...path, key];
      const line = { field: at.join('.'), label: at.map(fieldLabel).join(' · ') };
      const masked = maskOf(value);
      if (masked) out.push({ ...line, kind: masked === 'changed' ? 'change' : 'value', from: null, to: null, masked });
      else if (isPair(value)) out.push({ ...line, kind: 'change', from: valueText(value.from, names), to: valueText(value.to, names), masked: null });
      else if (isObject(value) && Object.keys(value).length > 0) walk(value, at);
      else out.push({ ...line, kind: 'value', from: null, to: isObject(value) ? null : valueText(value, names), masked: null });
    }
  };
  walk(diff, []);
  return out;
}

/** A line of changes in words, for the Excel export: "Gross salary: changed (not shown)", "Status: Draft → Sent". */
export function changeText(c: AuditChange): string {
  if (c.masked) return `${c.label}: ${c.masked} (not shown)`;
  if (c.kind === 'value') return `${c.label}: ${c.to ?? '—'}`;
  return `${c.label}: ${c.from ?? '—'} → ${c.to ?? '—'}`;
}

// ---------- who, what and whom ----------

const personText = (p: AuditPerson | null | undefined) => p?.name ?? p?.email ?? 'A user no longer on record';

/**
 * Who did it, in words; a Super Admin who viewed as someone with Act as them on: "Super Admin X as Y"; through the Claude
 * connector (owner, 21 October 2026: "the connection method"): "Y via Claude connector".
 */
export function whoOf(row: Pick<AuditRow, 'userId' | 'onBehalfById' | 'via' | 'action' | 'entityType'>, users: ReadonlyMap<string, AuditPerson>): AuditEntryView['who'] {
  const user = row.userId ? (users.get(row.userId) ?? null) : null;
  const by = row.onBehalfById ? (users.get(row.onBehalfById) ?? null) : null;
  let text: string;
  if (row.userId) text = personText(user);
  else if (row.action === 'login_failed') text = 'Not signed in';
  else if (row.entityType === 'job_offer' && row.action === 'answer') text = 'The candidate, online';
  else if (row.entityType === 'job_application' && row.action === 'apply') text = 'The applicant, on the careers page';
  else text = 'System';
  if (row.onBehalfById) text = `Super Admin ${personText(by)} as ${text}`;
  const via = row.via === AUDIT_VIA_CONNECTOR ? AUDIT_VIA_CONNECTOR : null;
  if (via) text = `${text} via Claude connector`;
  return { text, user, by, via };
}

const stringAt = (diff: unknown, key: string): string | null => {
  if (!isObject(diff)) return null;
  const v = diff[key];
  return typeof v === 'string' && v ? v : null;
};

/**
 * The person an entry is about: the employee it is on, the owner of the record it is on (an employment, a contract, a
 * payroll line …), else the employeeId, employmentId or employeeCode its diff names. Null when none, or deleted since.
 */
export function employeeOf(row: Pick<AuditRow, 'entityType' | 'entityId' | 'diff'>, refs: AuditRefs): AuditEmployee | null {
  const record = row.entityId ? refs.records.get(recordKey(row.entityType, row.entityId)) : undefined;
  const employmentId = stringAt(row.diff, 'employmentId');
  const ids = [
    row.entityType === 'employee' ? row.entityId : null,
    record?.employeeId ?? null,
    stringAt(row.diff, 'employeeId'),
    employmentId ? (refs.records.get(recordKey('employment', employmentId))?.employeeId ?? null) : null,
  ];
  for (const id of ids) {
    const found = id ? refs.employees.get(id) : undefined;
    if (found) return found;
  }
  // not by the code alone: once its holder is deleted, a code is given to the next one hired, who would be named for
  // entries that were never theirs; the code still shows among the changes
  return null;
}

/** The fields of a diff that name its record, in the order they are looked for. */
const REFERENCE_FIELDS = ['number', 'contract', 'code', 'nameEn', 'titleEn', 'fullNameEn', 'name', 'email', 'key', 'slot', 'month', 'year', 'fileName'];

/** The record's own words: from the database when it is still there, else from its diff; null when nothing names it. */
export function referenceOf(row: Pick<AuditRow, 'entityType' | 'entityId' | 'diff'>, refs: AuditRefs, employee: AuditEmployee | null): string | null {
  // the person is shown on their own
  if (row.entityType === 'employee' && employee) return null;
  const record = row.entityId ? refs.records.get(recordKey(row.entityType, row.entityId)) : undefined;
  if (record?.reference) return record.reference;
  if (isObject(row.diff)) {
    for (const key of REFERENCE_FIELDS) {
      const v = row.diff[key];
      const text = typeof v === 'string' || typeof v === 'number' ? v : isPair(v) ? (v.to ?? v.from) : null;
      if ((typeof text === 'string' && text && !maskOf(text)) || typeof text === 'number') return valueText(text, refs.names);
    }
  }
  return row.entityId ? (refs.names.get(row.entityId) ?? null) : null;
}

// ---------- where the record is ----------

const PEOPLE: Role[] = ['hr', 'ceo', 'finance']; // every profile (employees/access.ts seesEveryone)
const FILE: Role[] = ['hr', 'ceo']; // the employee file and the issued documents
const PAY: Role[] = ['hr', 'finance', 'ceo']; // payroll and salaries
const LEAVE: Role[] = ['hr', 'ceo'];
const ATTENDANCE: Role[] = ['hr', 'ceo', 'finance']; // the Attendance section
const DETAILS: Role[] = ['hr', 'admin', 'ceo'];
const OFFERS: Role[] = ['hr', 'ceo'];
const RECRUITMENT: Role[] = ['hr', 'ceo', 'super_admin']; // vacancies and applicants (22 October 2026)
const ORG: Role[] = ['hr', 'finance', 'ceo', 'admin'];
const USERS: Role[] = ['admin'];
const TEMPLATES: Role[] = ['super_admin'];
const KPIS: Role[] = ['hr', 'ceo', 'super_admin']; // All KPIs and its scorecards (21 October 2026)
const KPI_TEMPLATES: Role[] = ['hr', 'ceo', 'admin']; // the KPI templates' pages
// the Assets pages (21 October 2026): by each user's Assets access, not a role; of the Audit Log's readers, a Super Admin
// is always an Assets manager and the CEO at least a viewer who sets the values; the Rooms page is a manager's
const ASSETS: Role[] = ['super_admin', 'ceo'];
const ASSET_ROOMS: Role[] = ['super_admin'];

interface Target {
  href: string;
  label: string;
  roles: Role[];
}

/** The pages of a profile the records of a person are on (apps/web employees/tab-list.ts). */
const profile = (id: string, rest = '') => `/employees/${id}${rest}`;
const EMPLOYMENT = '?tab=employment';
const SALARY = '?tab=employment&sub=salary';

/** Where the record is, for whoever can open it; null when it has no page of its own, or is gone. */
function targetOf(row: Pick<AuditRow, 'entityType' | 'entityId' | 'diff'>, refs: AuditRefs, employee: AuditEmployee | null): Target | null {
  const id = row.entityId;
  const record = id ? refs.records.get(recordKey(row.entityType, id)) : undefined;
  const person = employee?.id;
  const onProfile = (rest: string, label: string, roles: Role[] = PEOPLE): Target | null => (person ? { href: profile(person, rest), label, roles } : null);
  const own = (href: string, label: string, roles: Role[]): Target | null => (record ? { href, label, roles } : null);
  switch (row.entityType) {
    case 'employee':
      return person ? { href: profile(person), label: 'Open profile', roles: PEOPLE } : null;
    case 'employment':
    case 'employment_ending':
    case 'profile_confirmation':
    case 'leave_adjustment':
      return onProfile(EMPLOYMENT, 'Open employment');
    case 'contract':
      return onProfile(`${EMPLOYMENT}#contract`, 'Open contract');
    case 'raise_request':
      return onProfile(`${SALARY}#raise-requests`, 'Open raise requests', PAY);
    case 'payroll_advance':
      return onProfile(`${SALARY}#advances`, 'Open advances and loans', PAY);
    case 'generated_document':
      return onProfile('?tab=employment&sub=documents', 'Open issued documents', FILE);
    case 'paperwork':
      return onProfile('?tab=documents', 'Open documents', FILE);
    case 'payroll_run':
      return id ? own(`/payroll/${id}`, 'Open payroll run', PAY) : null;
    case 'payroll_line':
      return record?.runId ? { href: `/payroll/${record.runId}`, label: 'Open payroll run', roles: PAY } : null;
    case 'attendance_import':
      return id && record?.runId ? { href: `/payroll/${record.runId}/attendance/${id}`, label: 'Open attendance import', roles: PAY } : null;
    case 'payroll_adjustment':
      return { href: '/payroll/adjustments', label: 'Open additions and deductions', roles: PAY };
    case 'recurring_deduction':
      return { href: '/payroll/recurring-deductions', label: 'Open recurring deductions', roles: PAY };
    case 'final_settlement':
      return { href: '/payroll/unsettled', label: 'Open unsettled', roles: PAY };
    case 'payroll_statistics':
      return { href: '/payroll/reports', label: 'Open payroll reports', roles: PAY };
    case 'salary_raises_report':
      return { href: '/payroll/reports/salary-raises', label: 'Open salary raises', roles: PAY };
    case 'leave_request':
      return id ? own(`/leave/${id}`, 'Open leave request', LEAVE) : null;
    case 'leave_document':
      return record?.parentId ? { href: `/leave/${record.parentId}`, label: 'Open leave request', roles: LEAVE } : null;
    case 'permission_request':
      return id ? own(`/leave/permissions/${id}`, 'Open permission request', LEAVE) : null;
    case 'wfh_request':
      return id ? own(`/attendance/wfh/${id}`, 'Open work from home request', LEAVE) : null;
    case 'attendance_correction':
      return id ? own(`/attendance/corrections/${id}`, 'Open attendance correction', LEAVE) : null;
    case 'attendance_day':
      return person ? { href: `/attendance/${person}`, label: 'Open attendance', roles: ATTENDANCE } : null;
    case 'reimbursement_claim':
      return id ? own(`/reimbursements/${id}`, 'Open reimbursement claim', PAY) : null;
    case 'reimbursement_receipt':
      return record?.parentId ? { href: `/reimbursements/${record.parentId}`, label: 'Open reimbursement claim', roles: PAY } : null;
    case 'profile_change_request':
      return { href: '/requests/details-changes', label: 'Open details changes', roles: DETAILS };
    case 'job_offer':
      return id ? own(`/offers/${id}`, 'Open job offer', OFFERS) : null;
    // recruitment (owner, 22 October 2026: "where will we include the ATS?")
    case 'vacancy':
      return id ? own(`/recruitment/vacancies/${id}`, 'Open vacancy', RECRUITMENT) : null;
    case 'job_application':
      return id ? own(`/recruitment/applicants/${id}`, 'Open applicant', RECRUITMENT) : null;
    case 'user':
      return id ? own(`/users/${id}`, 'Open user account', USERS) : null;
    case 'template_version':
      return record?.slot ? { href: `/templates/${record.slot}`, label: 'Open template', roles: TEMPLATES } : null;
    case 'department':
      return id ? own(`/organization/departments/${id}`, 'Open department', ORG) : null;
    case 'grade':
      return id ? own(`/organization/grades/${id}`, 'Open grade', ORG) : null;
    case 'job_title':
      return id ? own(`/organization/job-titles/${id}`, 'Open job title', ORG) : null;
    case 'shift':
      return id ? own(`/organization/shifts/${id}`, 'Open shift', ORG) : null;
    case 'allowance_type':
      return id ? own(`/organization/allowances/${id}`, 'Open allowance type', ORG) : null;
    case 'leave_type':
      return id ? own(`/organization/leave/types/${id}`, 'Open leave type', ORG) : null;
    case 'reimbursement_type':
      return id ? own(`/organization/payroll/reimbursement-types/${id}`, 'Open reimbursement type', ORG) : null;
    case 'company':
      return { href: '/organization/company', label: 'Open company', roles: ORG };
    case 'contract_settings':
      return { href: '/organization/contracts', label: 'Open contract defaults', roles: ORG };
    case 'ending_rule': {
      const key = stringAt(row.diff, 'key');
      return { href: key ? `/organization/contracts/rules/${encodeURIComponent(key)}` : '/organization/contracts', label: 'Open ending rules', roles: ORG };
    }
    case 'holiday':
      return { href: '/organization/holidays', label: 'Open holidays', roles: ORG };
    case 'leave_settings':
      return { href: '/organization/leave', label: 'Open leave setup', roles: ORG };
    case 'leave_year_closing':
      return { href: '/organization/leave/year-closing', label: 'Open year closing', roles: ORG };
    case 'payroll_settings':
    case 'payroll_law_rates':
      return { href: '/organization/payroll', label: 'Open payroll setup', roles: ORG };
    // KPIs (owner, 21 October 2026: "lets start with the KPI's First")
    case 'kpi_scorecard':
      return id ? own(`/kpis/scorecards/${id}`, 'Open KPI scorecard', KPIS) : { href: '/kpis/all', label: 'Open all KPIs', roles: KPIS };
    case 'kpi_template':
      return record?.parentId ? { href: `/kpis/templates/${record.parentId}`, label: 'Open KPI template', roles: KPI_TEMPLATES } : null;
    case 'kpi_settings':
      return { href: '/kpis/templates', label: 'Open KPI templates', roles: KPI_TEMPLATES };
    case 'kpi_framework':
      // KPI Pillars (22 October 2026): the company's, or a department's page
      return { href: record?.parentId ? `/kpis/pillars/${record.parentId}` : '/kpis/pillars', label: 'Open KPI pillars', roles: KPI_TEMPLATES };
    case 'kpi_report':
      return { href: '/kpis/all', label: 'Open all KPIs', roles: KPIS };
    // Assets (21 October 2026): an asset's page by its code (a photo's, its asset's); the rooms, kits and settings pages
    case 'asset':
    case 'asset_photo':
      return record?.reference ? { href: `/assets/${encodeURIComponent(record.reference)}`, label: 'Open asset', roles: ASSETS } : null;
    case 'asset_room':
      return { href: '/assets/rooms', label: 'Open rooms', roles: ASSET_ROOMS };
    case 'asset_kit':
      return { href: '/assets/kits', label: 'Open kits', roles: ASSETS };
    case 'asset_settings':
      return { href: '/assets/settings', label: 'Open asset settings', roles: ASSETS };
    // Assets step 5 (22 October 2026): a count's page; an export, the dashboard it is downloaded from
    case 'asset_count':
      return id ? { href: `/assets/counts/${id}`, label: 'Open count', roles: ASSETS } : { href: '/assets/counts', label: 'Open counts', roles: ASSETS };
    case 'asset_report':
      return { href: '/assets/dashboard', label: 'Open the Assets dashboard', roles: ASSETS };
    // custody (Assets step 3, 21 October 2026): the record's page by its code
    case 'custody_record':
      return record?.reference ? { href: `/assets/custody/${encodeURIComponent(record.reference)}`, label: 'Open custody record', roles: ASSETS } : null;
    case 'ocr_correction':
      return { href: '/employees/card-corrections', label: 'Open card reading fixes', roles: ['hr'] };
    default:
      return null;
  }
}

/** Where the record is, when the caller can open that page (a Super Admin counts as an Admin); null otherwise. */
export function linkOf(row: Pick<AuditRow, 'entityType' | 'entityId' | 'diff'>, refs: AuditRefs, employee: AuditEmployee | null, roles: readonly Role[]) {
  const target = targetOf(row, refs, employee);
  return target && actsAs(roles, target.roles) ? { href: target.href, label: target.label } : null;
}

/** The entry for reading, as the caller (by their roles) may follow its link. */
export function entryView(row: AuditRow, refs: AuditRefs, roles: readonly Role[]): AuditEntryView {
  const employee = employeeOf(row, refs);
  return {
    id: String(row.id),
    at: row.at.toISOString(),
    when: shownMoment(row.at),
    who: whoOf(row, refs.users),
    action: row.action,
    actionLabel: actionLabel(row.action),
    entityType: row.entityType,
    entityLabel: entityLabel(row.entityType),
    entityId: row.entityId,
    reference: referenceOf(row, refs, employee),
    employee,
    link: linkOf(row, refs, employee, roles),
    changes: changesOf(row.diff, refs.names),
  };
}

/** Every id an entry's diff holds (at any depth), for the service to look their names up. */
export function idsIn(diff: unknown, out: Set<string> = new Set()): Set<string> {
  if (isUuid(diff)) out.add(diff.toLowerCase());
  else if (Array.isArray(diff)) for (const v of diff) idsIn(v, out);
  else if (isObject(diff)) for (const v of Object.values(diff)) idsIn(v, out);
  return out;
}

/** The employee codes an entry's diff names (employeeCode, at its top level). */
export function codeIn(diff: unknown): string | null {
  return stringAt(diff, 'employeeCode');
}
