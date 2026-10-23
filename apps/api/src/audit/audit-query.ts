import { Prisma } from '../generated/prisma/client.js';

// Which audit_log entries the Audit Log page lists (owner, 19 October 2026: "an Audit Log page showing who changed what
// and when"), as the WHERE of one SQL query: the free text is searched in the diff as text (jsonb::text ILIKE), which
// Prisma's filters can't do. Every value is a bound parameter; the table and column names are this file's own.

export interface AuditFilters {
  /** The first day, YYYY-MM-DD, in Cairo. */
  from?: string;
  /** The last day, YYYY-MM-DD, in Cairo (the whole day). */
  to?: string;
  /** Who did it: the user, or the Super Admin who did it viewing as someone. */
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  /** Text anywhere in the diff, whatever the case. */
  q?: string;
  /** Older than this entry (audit_log.id): the next page after it. */
  before?: string;
}

/** People, by id and by their employee code (the diffs of payroll lines and additions name them by code). */
export interface People {
  ids: readonly string[];
  codes: readonly string[];
}

/** `q` as an ILIKE pattern that matches it anywhere, its own %, _ and \ taken literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The kinds of record whose table has the person's employee_id, by entity type. */
const OWNED: readonly (readonly [entityType: string, table: string])[] = [
  ['raise_request', 'raise_requests'],
  ['generated_document', 'generated_documents'],
  ['paperwork', 'paperwork_items'],
  ['payroll_line', 'payroll_lines'],
  ['payroll_adjustment', 'payroll_adjustments'],
  ['payroll_advance', 'payroll_advances'],
  ['recurring_deduction', 'recurring_deductions'],
  ['leave_request', 'leave_requests'],
  ['permission_request', 'permission_requests'],
  ['wfh_request', 'wfh_requests'],
  ['od_request', 'od_requests'],
  ['attendance_correction', 'attendance_corrections'],
  ['attendance_day', 'attendance_days'],
  ['leave_adjustment', 'leave_adjustments'],
  ['reimbursement_claim', 'reimbursement_claims'],
  ['profile_confirmation', 'profile_confirmations'],
  ['profile_change_request', 'profile_change_requests'],
  ['job_offer', 'job_offers'],
];

/**
 * The entries about these people (an employee's History, owner, 19 October 2026: everything about one person): those on
 * their profile, on a record of theirs (an employment and its final settlement, a contract, an ending, a raise request,
 * a payroll line, an addition or deduction, a loan, leave, a permission, a claim and its receipts, a document, a change
 * request, a job offer …), and those whose diff names them (employeeId, employmentId), which also finds the entries on
 * records deleted since. Not by employee code: a code is given again once its holder is deleted (the next code is the
 * highest + 1), so a code would bring in someone else's entries. Never null: false where a diff has none of these.
 */
export function aboutPeople(people: People): Prisma.Sql {
  const ids = Prisma.sql`${[...people.ids]}::uuid[]`;
  const texts = Prisma.sql`${[...people.ids]}::text[]`;
  const employments = Prisma.sql`SELECT e.id FROM employments e WHERE e.employee_id = ANY(${ids})`;
  const parts: Prisma.Sql[] = [
    Prisma.sql`(a.entity_type = 'employee' AND a.entity_id = ANY(${ids}))`,
    Prisma.sql`a.diff->>'employeeId' = ANY(${texts})`,
    Prisma.sql`a.diff->>'employmentId' IN (SELECT e.id::text FROM employments e WHERE e.employee_id = ANY(${ids}))`,
    Prisma.sql`(a.entity_type IN ('employment', 'final_settlement') AND a.entity_id IN (${employments}))`,
    Prisma.sql`(a.entity_type = 'contract' AND a.entity_id IN (SELECT c.id FROM contracts c WHERE c.employment_id IN (${employments})))`,
    Prisma.sql`(a.entity_type = 'employment_ending' AND a.entity_id IN (SELECT x.id FROM employment_endings x WHERE x.employment_id IN (${employments})))`,
    Prisma.sql`(a.entity_type = 'leave_document' AND a.entity_id IN (SELECT d.id FROM leave_documents d JOIN leave_requests r ON r.id = d.request_id WHERE r.employee_id = ANY(${ids})))`,
    Prisma.sql`(a.entity_type = 'reimbursement_receipt' AND a.entity_id IN (SELECT x.id FROM reimbursement_receipts x JOIN reimbursement_claims r ON r.id = x.claim_id WHERE r.employee_id = ANY(${ids})))`,
    ...OWNED.map(([type, table]) => Prisma.sql`(a.entity_type = ${type} AND a.entity_id IN (SELECT t.id FROM ${Prisma.raw(`"${table}"`)} t WHERE t.employee_id = ANY(${ids})))`),
  ];
  return Prisma.sql`COALESCE((${Prisma.join(parts, ' OR ')}), false)`;
}

/**
 * The WHERE of the entries asked for (nothing when nothing is asked): the filters, the person's entries (`about`: an
 * employee's History), and never those about the people hidden from the caller (`hidden`: C-level people for anyone but
 * the CEO and a Super Admin, who are the only ones here, so kept for safety: packages/shared confidential.ts).
 */
export function auditWhere(f: AuditFilters, about?: People | null, hidden?: People | null): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  // the days are Cairo's: from its midnight at the start of `from` to its midnight at the end of `to`
  if (f.from) parts.push(Prisma.sql`a.at >= (${f.from}::date::timestamp AT TIME ZONE 'Africa/Cairo')`);
  if (f.to) parts.push(Prisma.sql`a.at < ((${f.to}::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')`);
  if (f.userId) parts.push(Prisma.sql`(a.user_id = ${f.userId}::uuid OR a.on_behalf_by = ${f.userId}::uuid)`);
  if (f.action) parts.push(Prisma.sql`a.action = ${f.action}`);
  if (f.entityType) parts.push(Prisma.sql`a.entity_type = ${f.entityType}`);
  if (f.entityId) parts.push(Prisma.sql`a.entity_id = ${f.entityId}::uuid`);
  if (f.q) parts.push(Prisma.sql`a.diff::text ILIKE ${likePattern(f.q)}`);
  if (f.before) parts.push(Prisma.sql`a.id < ${f.before}::bigint`);
  if (about) parts.push(aboutPeople(about));
  if (hidden && hidden.ids.length) parts.push(Prisma.sql`NOT ${aboutPeople(hidden)}`);
  return parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}
