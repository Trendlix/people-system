import { EMPLOYMENT_TYPES, LABELS, reimbursementRulesText, type EmploymentType, type Role } from '@trendlix/shared';
import { departmentName, groupDepartments } from '../../../../lib/departments';
import { hasRole } from '../../../../lib/roles';
import type { Department, GradeRef, ReimbursementTypeBody, ReimbursementTypeView } from '../../../../lib/types';
import { formatEgp, parseAmount } from '../../employees/[id]/contracts/salary';

// Payroll Setup, Reimbursement Types (owner, 18 October 2026: "allow the employee to add reimbursement request … for
// specific preset up conditions", and "in the setup i need to enter for it a cap"): the kinds of expense employees may
// claim back, each with its conditions: the caps (a claim, a month, a year), whether a receipt is required, within how
// many days of the expense it is claimed, and who may claim it (departments, a department taking its teams with it;
// grades; employment types; none chosen: everyone). HR adds and changes them (POST and PATCH /reimbursement-types), and
// turns one off rather than deleting it; Finance, the CEO and Admin read them; only a Super Admin deletes one no claim
// uses. Changed conditions apply to the claims sent afterwards. Pure code, tested: who sees and changes them, the form
// as typed into what the API takes (with the API's checks and words), and the words the list shows them in. Relative
// imports: the tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };

/** HR, Finance, the CEO and Admin (a Super Admin too) read the types (GET /reimbursement-types). */
export function seesReimbursementTypes(user: WithRoles): boolean {
  return hasRole(user, 'hr', 'finance', 'ceo', 'admin');
}

/** HR adds and changes them, and turns them off. The API checks this again. */
export function editsReimbursementTypes(user: WithRoles): boolean {
  return hasRole(user, 'hr');
}

/** The section on Payroll Setup, and the pages to add and change a type. */
export const REIMBURSEMENT_TYPES_ID = 'reimbursement-types';
export const REIMBURSEMENT_TYPES_HREF = `/organization/payroll#${REIMBURSEMENT_TYPES_ID}`;
export const NEW_REIMBURSEMENT_TYPE_HREF = '/organization/payroll/reimbursement-types/new';
export const reimbursementTypeHref = (id: string) => `/organization/payroll/reimbursement-types/${encodeURIComponent(id)}`;

// ---------- the form ----------

/** The largest amount the API keeps (12 digits, 2 of them decimals). */
const MAX_MONEY = 9_999_999_999.99;

export const NAME_EN_ERROR = 'Enter the name in English (up to 100 characters), e.g. Mobile bill.';
export const NAME_AR_ERROR = 'Enter the name in Arabic (up to 100 characters), e.g. فاتورة المحمول.';
export const DESCRIPTION_ERROR = 'Keep the description to 500 characters or fewer.';
export const DAYS_ERROR = 'Enter the days after the expense it must be claimed within, 1 to 365, or leave it empty for no deadline.';
const capError = (what: string) => `Enter the cap ${what} as an amount of more than 0, e.g. 500 or 750.50, or leave it empty for no cap.`;

/** The caps, each with its field's name and how a sentence calls it. */
export const CAP_FIELDS = [
  { key: 'capPerClaim', label: 'A claim', what: 'a claim' },
  { key: 'capPerMonth', label: 'A month', what: 'a month' },
  { key: 'capPerYear', label: 'A year', what: 'a year' },
] as const;

export type CapKey = (typeof CAP_FIELDS)[number]['key'];

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();
const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');

/** A cap as typed: null when left empty, NaN when it isn't an amount of more than 0 within what the API keeps. */
export function capFrom(raw: string): number | null {
  const n = parseAmount(latin(raw));
  if (n === null) return null;
  return Number.isNaN(n) || n <= 0 || n > MAX_MONEY ? NaN : n;
}

/** The deadline as typed: null when left empty, NaN unless a whole number of days from 1 to 365. */
export function daysFrom(raw: string): number | null {
  const s = latin(raw).trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return NaN;
  const n = Number(s);
  return n >= 1 && n <= 365 ? n : NaN;
}

/**
 * Why the caps don't fit together, or null (the API's check, in its words): a claim's cap no more than a month's or a
 * year's, a month's no more than a year's.
 */
export function capsProblem(c: Record<CapKey, number | null>): string | null {
  const over = (a: number | null, b: number | null) => a !== null && b !== null && Math.round(a * 100) > Math.round(b * 100);
  if (over(c.capPerClaim, c.capPerMonth)) return `The cap a claim (${formatEgp(c.capPerClaim!)}) can't be more than the cap a month (${formatEgp(c.capPerMonth!)}).`;
  if (over(c.capPerMonth, c.capPerYear)) return `The cap a month (${formatEgp(c.capPerMonth!)}) can't be more than the cap a year (${formatEgp(c.capPerYear!)}).`;
  if (over(c.capPerClaim, c.capPerYear)) return `The cap a claim (${formatEgp(c.capPerClaim!)}) can't be more than the cap a year (${formatEgp(c.capPerYear!)}).`;
  return null;
}

/**
 * The form as POST and PATCH /reimbursement-types take it, all of it (a cap, the deadline or the description left empty
 * is null: none), and what is wrong, as the API would say it. The checkboxes are sent only when ticked: Receipt
 * required and On, and each department, grade and employment type chosen.
 */
export function typeBody(fd: FormData): { body: ReimbursementTypeBody; errors: string[] } {
  const errors: string[] = [];
  const nameEn = text(fd, 'nameEn');
  const nameAr = text(fd, 'nameAr');
  if (!nameEn || nameEn.length > 100) errors.push(NAME_EN_ERROR);
  if (!nameAr || nameAr.length > 100) errors.push(NAME_AR_ERROR);
  const description = text(fd, 'description');
  if (description.length > 500) errors.push(DESCRIPTION_ERROR);

  const caps = {} as Record<CapKey, number | null>;
  for (const f of CAP_FIELDS) {
    const cap = capFrom(text(fd, f.key));
    if (cap !== null && Number.isNaN(cap)) errors.push(capError(f.what));
    caps[f.key] = cap !== null && Number.isNaN(cap) ? null : cap;
  }
  if (!errors.some((e) => e.startsWith('Enter the cap'))) {
    const problem = capsProblem(caps);
    if (problem) errors.push(problem);
  }
  const days = daysFrom(text(fd, 'claimWithinDays'));
  if (days !== null && Number.isNaN(days)) errors.push(DAYS_ERROR);

  const all = (key: string) => [...new Set(fd.getAll(key).map(String).filter(Boolean))];
  const body: ReimbursementTypeBody = {
    nameEn,
    nameAr,
    description: description || null,
    receiptRequired: fd.has('receiptRequired'),
    ...caps,
    claimWithinDays: days !== null && Number.isNaN(days) ? null : days,
    departmentIds: all('departmentIds'),
    gradeIds: all('gradeIds'),
    employmentTypes: all('employmentTypes').filter((t) => (EMPLOYMENT_TYPES as readonly string[]).includes(t)),
    active: fd.has('active'),
  };
  return { body, errors };
}

/**
 * What the conditions typed come to, as the employee will read them (reimbursementRulesText), live under the form:
 * "Receipt needed · Up to EGP 500.00 a claim, 1,000.00 a month · Within 30 days of the expense". Null while a cap or
 * the deadline isn't one yet.
 */
export function typedRulesText(typed: { receiptRequired: boolean; claimWithinDays: string } & Record<CapKey, string>): string | null {
  const caps = CAP_FIELDS.map((f) => capFrom(typed[f.key]));
  const days = daysFrom(typed.claimWithinDays);
  if (caps.some((c) => c !== null && Number.isNaN(c)) || (days !== null && Number.isNaN(days))) return null;
  return reimbursementRulesText({ receiptRequired: typed.receiptRequired, capPerClaim: caps[0], capPerMonth: caps[1], capPerYear: caps[2], claimWithinDays: days });
}

/** A cap's field as the form starts with it: its amount, or empty for none. */
export const capField = (n: number | null) => (n === null ? '' : String(Math.round(n * 100) / 100));

// ---------- in words ----------

/** A cap as the list shows it: "EGP 500.00", or "No cap". */
export const capText = (n: number | null) => (n === null ? 'No cap' : formatEgp(n));

/** "3 claims", "1 claim", "No claims yet". */
export const claimsCountText = (n: number) => (n === 0 ? 'No claims yet' : `${n} ${n === 1 ? 'claim' : 'claims'}`);

/**
 * Who may claim a type, a line for each list chosen: "Departments: Marketing, Sales › Field Team", "Grades: G3, G4",
 * "Employment types: Full-time, Part-time"; ["Everyone"] when none is. A department or grade no longer on file is
 * counted, not named.
 */
export function whoCanClaim(
  t: Pick<ReimbursementTypeView, 'departmentIds' | 'gradeIds' | 'employmentTypes'>,
  departments: readonly Pick<Department, 'id' | 'nameEn' | 'parent'>[],
  grades: readonly Pick<GradeRef, 'id' | 'code'>[],
): string[] {
  const named = <T extends { id: string }>(ids: readonly string[], list: readonly T[], name: (x: T) => string) => {
    const found = ids.map((id) => list.find((x) => x.id === id)).filter((x): x is T => !!x);
    const missing = ids.length - found.length;
    return [...found.map(name), ...(missing ? [`${missing} no longer on file`] : [])].join(', ');
  };
  const lines: string[] = [];
  if (t.departmentIds.length) lines.push(`Departments: ${named(t.departmentIds, departments, departmentName)}`);
  if (t.gradeIds.length) lines.push(`Grades: ${named(t.gradeIds, grades, (g) => g.code)}`);
  if (t.employmentTypes.length) lines.push(`Employment types: ${t.employmentTypes.map((e) => LABELS.employmentType[e as EmploymentType] ?? e).join(', ')}`);
  return lines.length ? lines : ['Everyone'];
}

/** The departments the form offers, each with its teams under it, in the API's order. */
export function departmentChoices(departments: Department[]): { id: string; label: string; teams: { id: string; label: string }[] }[] {
  return groupDepartments(departments).map(({ department, teams }) => ({
    id: department.id,
    label: departmentName(department),
    teams: teams.map((t) => ({ id: t.id, label: t.nameEn })),
  }));
}
