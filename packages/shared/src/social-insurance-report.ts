// The Social Insurance report (owner, 27 October 2026: "is there a report for the social insurance? to be filled from the
// social insurance tab"; asked which, he chose all three: the insured staff register, the monthly contributions and the
// missing data checklist), under Payroll → Reports. "Filled from the social insurance tab": every figure is what HR keeps
// on each employee's profile → Social Insurance tab (registered or not, the occupation, the subscription start, the basic
// and comprehensive wages, Forms 1 and 6 and the print) and the insurance number on Basic Data, the insured wage worked
// out as the tab works it out (the comprehensive wage, the employee's own else the contract's gross and allowances,
// within the year's insurable limits), and both shares on it as payroll works them out; never a payroll run's figures
// (the Payroll vs Social Insurance report compares the two). Pure code: the API sends the three views (GET
// /payroll/social-insurance/…) and makes their workbooks from them; the screens word them.
// - The register: one row per person registered with social insurance in an employment under the labour law (full time
//   or part time: freelancers and unpaid interns aren't insured), their current employment, else their latest, with the
//   tab's details, the insured wage on this year's rates, the employee's and the company's shares, and where Forms 1
//   and 6 and the print stand. Filtered by department and status (current employees unless asked; leavers on request).
// - The monthly contributions: for a month, everyone registered whose employment under the labour law touches it, the
//   insured wage on that year's rates and the whole month's shares (payroll doesn't prorate them for a part month),
//   joiners and leavers of the month marked, and the totals to pay the insurance office.
// - The missing data: who is missing something on their Social Insurance tab: registration (a full-time employee), the
//   insurance number, the occupation, the subscription start, Form 1 not generated or the print not received (a
//   full-time employee's: the forms and the print are for full-time employments).

import { insuredWageFrom } from './contracts.js';
import { underLabourLaw, type EmploymentType, type Standing } from './index.js';
import { ratesOf, type LawRatesOrYear } from './law-rates.js';
import { occupationName } from './occupations.js';

// ---------- the views ----------

export const SI_REPORT_VIEWS = ['register', 'contributions', 'missing'] as const;
export type SiReportView = (typeof SI_REPORT_VIEWS)[number];

export const SI_REPORT_VIEW_LABELS: Record<SiReportView, string> = {
  register: 'Register',
  contributions: 'Monthly contributions',
  missing: 'Missing data',
};

// ---------- who is on it ----------

/** Social insurance applies to an employment under the labour law: full time or part time, not a freelancer or an unpaid intern. */
export const siApplies = (type: EmploymentType | string): boolean => underLabourLaw(type);

/** On the register and the month's contributions: registered on their Social Insurance tab, in an employment under the labour law. */
export const siInsured = (type: EmploymentType | string, registered: boolean): boolean => registered && siApplies(type);

/**
 * On the missing data checklist: a full-time employment (Forms 1 and 6 and the print are for full-time employments, and
 * a full-time employee is expected to be registered), or anyone insured (a registered part-timer).
 */
export const siChecked = (type: EmploymentType | string, registered: boolean): boolean => type === 'full_time' || siInsured(type, registered);

// ---------- the register's status filter ----------

/** Current employees (the default), one standing of theirs, the leavers, or everyone. */
export const SI_REGISTER_STATUSES = ['current', 'active', 'probation', 'on_leave', 'notice_period', 'former', 'all'] as const;
export type SiRegisterStatus = (typeof SI_REGISTER_STATUSES)[number];
export const SI_REGISTER_STATUS_DEFAULT: SiRegisterStatus = 'current';

export const SI_REGISTER_STATUS_LABELS: Record<SiRegisterStatus, string> = {
  current: 'Current employees',
  active: 'Active',
  probation: 'Probation',
  on_leave: 'On leave',
  notice_period: 'Notice period',
  former: 'Leavers',
  all: 'Everyone, leavers too',
};

/** Whether someone of this standing is on the register for the status asked. */
export function siStatusMatches(status: SiRegisterStatus, standing: Standing): boolean {
  if (status === 'all') return true;
  if (status === 'current') return standing !== 'former' && standing !== 'not_employed';
  return standing === status;
}

// ---------- the shares ----------

const piasters = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100 + 0;

/**
 * A month's social insurance on an insured wage, as payroll works it out (payroll.ts): the employee's share (11% in 2026)
 * and the company's (18.75%), each rounded to the piaster, by the year's rates set by law.
 */
export function siShares(insuredWage: number, rates: LawRatesOrYear): { employeeInsurance: number; employerInsurance: number } {
  const law = ratesOf(rates);
  const wage = piasters(insuredWage);
  return { employeeInsurance: piasters(wage * law.employeeInsuranceRate), employerInsurance: piasters(wage * law.employerInsuranceRate) };
}

/** The year's rates the report worked with, as it sends them: the shares as fractions (0.11) and the insurable limits a month. */
export interface SiRates {
  year: number;
  employeeInsuranceRate: number;
  employerInsuranceRate: number;
  insurableWageMin: number;
  insurableWageMax: number;
}

export function siRatesOf(rates: LawRatesOrYear): SiRates {
  const r = ratesOf(rates);
  return {
    year: r.year,
    employeeInsuranceRate: r.employeeInsuranceRate,
    employerInsuranceRate: r.employerInsuranceRate,
    insurableWageMin: r.insurableWageMin,
    insurableWageMax: r.insurableWageMax,
  };
}

/** A rate as a percent: 0.11 → "11%", 0.1875 → "18.75%". */
export const siPercent = (rate: number): string => `${Math.round(rate * 10000) / 100}%`;

// ---------- Forms 1 and 6 and the print ----------

/** A generated document's steps (documents: generated, printed, signed copy uploaded, verified), in order. */
const FORM_PROGRESS = ['generated', 'printed', 'signed', 'verified'] as const;
type FormProgress = (typeof FORM_PROGRESS)[number];

/**
 * Where a form stands: the furthest along of its documents for the employment, Not generated, Not due (Form 6 before the
 * employment has an ending), or Not for this type (Forms 1 and 6 are for full-time employments).
 */
export const SI_FORM_STATES = ['not_generated', ...FORM_PROGRESS, 'not_due', 'not_applicable'] as const;
export type SiFormState = (typeof SI_FORM_STATES)[number];

export const SI_FORM_STATE_LABELS: Record<SiFormState, string> = {
  not_generated: 'Not generated',
  generated: 'Generated',
  printed: 'Printed',
  signed: 'Signed copy uploaded',
  verified: 'Verified',
  not_due: 'Not due',
  not_applicable: 'Not for this type',
};

/** The furthest along of a form's documents (one generated again keeps the one already signed or verified); null with none. */
export function siFurthest(statuses: readonly string[]): FormProgress | null {
  let best = -1;
  for (const s of statuses) best = Math.max(best, (FORM_PROGRESS as readonly string[]).indexOf(s));
  return best < 0 ? null : FORM_PROGRESS[best];
}

/** Form 1 (joining): for a full-time employment, how far along it is, or Not generated. */
export function siForm1State(type: EmploymentType | string, statuses: readonly string[]): SiFormState {
  if (type !== 'full_time') return 'not_applicable';
  return siFurthest(statuses) ?? 'not_generated';
}

/** Form 6 (leaving): due once the employment has an ending (not one rejected or withdrawn) or has ended; Not due before then. */
export function siForm6State(type: EmploymentType | string, due: boolean, statuses: readonly string[]): SiFormState {
  if (type !== 'full_time') return 'not_applicable';
  return siFurthest(statuses) ?? (due ? 'not_generated' : 'not_due');
}

/** The social insurance print (برنت التأمينات) in the employee file: received, not received (a full-time employee's file needs it), or not needed. */
export const SI_PRINT_STATES = ['received', 'not_received', 'not_needed'] as const;
export type SiPrintState = (typeof SI_PRINT_STATES)[number];

export const SI_PRINT_STATE_LABELS: Record<SiPrintState, string> = { received: 'Received', not_received: 'Not received', not_needed: 'Not needed' };

export function siPrintState(type: EmploymentType | string, receivedOn: string | null): SiPrintState {
  if (receivedOn) return 'received';
  return type === 'full_time' ? 'not_received' : 'not_needed';
}

// ---------- what each row is made from ----------

/** Where someone works: a department, or a team with its department; null when not placed. */
export interface SiPlace {
  nameEn: string;
  parent: { nameEn: string } | null;
}

export interface SiPerson {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
}

/** A person and the employment the row is about, as the API reads them (dates YYYY-MM-DD). */
export interface SiSource {
  employee: SiPerson;
  /** The Social Insurance tab's own details, and the insurance number (Basic Data). Wages in EGP a month; none: not set. */
  tab: {
    insuranceNo: string | null;
    occupationCode: string | null;
    insuranceStartDate: string | null;
    insuranceBasicWage: number | null;
    insuranceComprehensiveWage: number | null;
    socialInsured: boolean;
  };
  /** The national ID as the caller may have it (masked on the screen, in full in an HR or CEO workbook); null when not theirs to see. */
  nationalId: string | null;
  employment: {
    id: string;
    employmentType: EmploymentType;
    standing: Standing;
    joinDate: string;
    /** Its end: its end date, or an approved ending's last working day when earlier (as payroll ends it); null for neither. */
    leftOn: string | null;
    /** It has an ending (not one rejected or withdrawn) or has ended: Form 6 is due. */
    endingRecorded: boolean;
    department: SiPlace | null;
  };
  /** The signed contract's gross and allowances the insured wage stands on (after a raise, the pay before it until Form 2 or January); null without one. */
  contractPay: number | null;
  /** Forms 1 and 6 (each document's status, for this employment) and the print's latest upload day; null when the caller doesn't see the employee file. */
  file: { form1: readonly string[]; form6: readonly string[]; printReceivedOn: string | null } | null;
}

/** The comprehensive wage the insured wage is worked out from: the employee's own, else the contract's; and where it came from. */
function comprehensiveOf(s: Pick<SiSource, 'tab' | 'contractPay'>): { amount: number | null; from: 'own' | 'contract' | null } {
  if (s.tab.insuranceComprehensiveWage !== null) return { amount: s.tab.insuranceComprehensiveWage, from: 'own' };
  if (s.contractPay !== null) return { amount: s.contractPay, from: 'contract' };
  return { amount: null, from: null };
}

/** The insured wage within the year's limits and both shares on it; all null without a comprehensive wage. */
function insuredOf(comprehensive: number | null, rates: LawRatesOrYear) {
  if (comprehensive === null) return { insuredWage: null, employeeInsurance: null, employerInsurance: null };
  const insuredWage = insuredWageFrom(comprehensive, rates).amount;
  return { insuredWage, ...siShares(insuredWage, rates) };
}

// ---------- the register ----------

export interface SiRegisterRow {
  employee: SiPerson;
  employmentId: string;
  department: SiPlace | null;
  employmentType: EmploymentType;
  standing: Standing;
  joinDate: string;
  leftOn: string | null;
  insuranceNo: string | null;
  nationalId: string | null;
  occupationCode: string | null;
  occupationName: string | null;
  /** The employee's own; none: Form 1 prints the join date. */
  insuranceStartDate: string | null;
  /** The employee's own, else the contract settings' default (`basicFrom`). */
  insuranceBasicWage: number;
  basicFrom: 'own' | 'default';
  /** The employee's own, else the contract's gross and allowances (`comprehensiveFrom`); null with neither. */
  insuranceComprehensiveWage: number | null;
  comprehensiveFrom: 'own' | 'contract' | null;
  insuredWage: number | null;
  employeeInsurance: number | null;
  employerInsurance: number | null;
  /** Null when the caller doesn't see the employee file (HR and the CEO do). */
  form1: SiFormState | null;
  form6: SiFormState | null;
  print: SiPrintState | null;
  printReceivedOn: string | null;
}

/** A register row: the tab's details, the insured wage on the year's rates and both shares, and where the forms and the print stand. */
export function siRegisterRow(s: SiSource, rates: LawRatesOrYear, basicDefault: number): SiRegisterRow {
  const e = s.employment;
  const comprehensive = comprehensiveOf(s);
  return {
    employee: s.employee,
    employmentId: e.id,
    department: e.department,
    employmentType: e.employmentType,
    standing: e.standing,
    joinDate: e.joinDate,
    leftOn: e.leftOn,
    insuranceNo: s.tab.insuranceNo,
    nationalId: s.nationalId,
    occupationCode: s.tab.occupationCode,
    occupationName: occupationName(s.tab.occupationCode),
    insuranceStartDate: s.tab.insuranceStartDate,
    insuranceBasicWage: s.tab.insuranceBasicWage ?? basicDefault,
    basicFrom: s.tab.insuranceBasicWage === null ? 'default' : 'own',
    insuranceComprehensiveWage: comprehensive.amount,
    comprehensiveFrom: comprehensive.from,
    ...insuredOf(comprehensive.amount, rates),
    form1: s.file ? siForm1State(e.employmentType, s.file.form1) : null,
    form6: s.file ? siForm6State(e.employmentType, e.endingRecorded, s.file.form6) : null,
    print: s.file ? siPrintState(e.employmentType, s.file.printReceivedOn) : null,
    printReceivedOn: s.file?.printReceivedOn ?? null,
  };
}

// ---------- the monthly contributions ----------

export interface SiMonthRow {
  employee: SiPerson;
  employmentId: string;
  department: SiPlace | null;
  employmentType: EmploymentType;
  insuranceNo: string | null;
  joinDate: string;
  leftOn: string | null;
  insuranceComprehensiveWage: number | null;
  comprehensiveFrom: 'own' | 'contract' | null;
  insuredWage: number | null;
  employeeInsurance: number | null;
  employerInsurance: number | null;
}

/** A month's row: the insured wage on that year's rates and the whole month's shares, whether they joined or left in it. */
export function siMonthRow(s: SiSource, rates: LawRatesOrYear): SiMonthRow {
  const e = s.employment;
  const comprehensive = comprehensiveOf(s);
  return {
    employee: s.employee,
    employmentId: e.id,
    department: e.department,
    employmentType: e.employmentType,
    insuranceNo: s.tab.insuranceNo,
    joinDate: e.joinDate,
    leftOn: e.leftOn,
    insuranceComprehensiveWage: comprehensive.amount,
    comprehensiveFrom: comprehensive.from,
    ...insuredOf(comprehensive.amount, rates),
  };
}

/** Whether the employment started in the month (a joiner) and whether it ended in it (a leaver); `month` YYYY-MM. */
export function siMonthMarks(row: { joinDate: string | null; leftOn: string | null }, month: string): { joined: boolean; left: boolean } {
  return { joined: row.joinDate?.slice(0, 7) === month, left: row.leftOn?.slice(0, 7) === month };
}

/** The marks in words: "Joined", "Left", "Joined and left"; null for neither. */
export function siMarksText(marks: { joined: boolean; left: boolean }): string | null {
  if (marks.joined && marks.left) return 'Joined and left';
  if (marks.joined) return 'Joined';
  return marks.left ? 'Left' : null;
}

// ---------- the totals ----------

export interface SiTotals {
  /** Everyone listed. */
  people: number;
  /** Those with an insured wage (the others have no comprehensive wage on the tab and no signed contract). */
  insured: number;
  insuredWage: number;
  employeeInsurance: number;
  employerInsurance: number;
  /** Both shares: what is paid to the insurance office. */
  toPay: number;
}

/** The totals of the rows, added in piasters. */
export function siTotals(rows: readonly Pick<SiRegisterRow, 'insuredWage' | 'employeeInsurance' | 'employerInsurance'>[]): SiTotals {
  const cents = (pick: (r: (typeof rows)[number]) => number | null) => rows.reduce((sum, r) => sum + Math.round((pick(r) ?? 0) * 100), 0);
  const employee = cents((r) => r.employeeInsurance);
  const employer = cents((r) => r.employerInsurance);
  return {
    people: rows.length,
    insured: rows.filter((r) => r.insuredWage !== null).length,
    insuredWage: cents((r) => r.insuredWage) / 100,
    employeeInsurance: employee / 100,
    employerInsurance: employer / 100,
    toPay: (employee + employer) / 100,
  };
}

// ---------- the missing data ----------

export const SI_MISSING_ITEMS = ['not_registered', 'insurance_no', 'occupation', 'start_date', 'form_1', 'print'] as const;
export type SiMissingItem = (typeof SI_MISSING_ITEMS)[number];

export const SI_MISSING_LABELS: Record<SiMissingItem, string> = {
  not_registered: 'Not registered with social insurance',
  insurance_no: 'Insurance number',
  occupation: 'Occupation',
  start_date: 'Subscription start',
  form_1: 'Form 1 not generated',
  print: 'Social insurance print not received',
};

/**
 * What is missing on someone's Social Insurance tab, in the checklist's order: registration (a full-time employee's), the
 * insurance number, the occupation, the subscription start (Form 1 prints the join date without it), and for a full-time
 * employee Form 1 not generated and the print not received (when the caller sees the employee file).
 */
export function siMissingItems(s: Pick<SiSource, 'tab' | 'employment' | 'file'>): SiMissingItem[] {
  const fullTime = s.employment.employmentType === 'full_time';
  const items: SiMissingItem[] = [];
  if (fullTime && !s.tab.socialInsured) items.push('not_registered');
  if (!s.tab.insuranceNo) items.push('insurance_no');
  if (!s.tab.occupationCode) items.push('occupation');
  if (!s.tab.insuranceStartDate) items.push('start_date');
  if (fullTime && s.file && s.file.form1.length === 0) items.push('form_1');
  if (fullTime && s.file && !s.file.printReceivedOn) items.push('print');
  return items;
}

export interface SiMissingRow {
  employee: SiPerson;
  employmentId: string;
  department: SiPlace | null;
  employmentType: EmploymentType;
  standing: Standing;
  joinDate: string;
  missing: SiMissingItem[];
}

export function siMissingRow(s: SiSource): SiMissingRow {
  const e = s.employment;
  return {
    employee: s.employee,
    employmentId: e.id,
    department: e.department,
    employmentType: e.employmentType,
    standing: e.standing,
    joinDate: e.joinDate,
    missing: siMissingItems(s),
  };
}

/** How many people miss each item. */
export function siMissingCounts(rows: readonly Pick<SiMissingRow, 'missing'>[]): Record<SiMissingItem, number> {
  const counts = Object.fromEntries(SI_MISSING_ITEMS.map((i) => [i, 0])) as Record<SiMissingItem, number>;
  for (const r of rows) for (const i of r.missing) counts[i] += 1;
  return counts;
}

// ---------- the order and the place ----------

/** A place split in two: its department, and the team within it (null for someone placed in the department itself). */
export function siPlaceParts(d: SiPlace | null): { department: string | null; team: string | null } {
  if (!d) return { department: null, team: null };
  return d.parent ? { department: d.parent.nameEn, team: d.nameEn } : { department: d.nameEn, team: null };
}

/** By department (none last), then team (the department's own people first), then name and employee code. */
export function siOrder(a: { department: SiPlace | null; employee: SiPerson }, b: { department: SiPlace | null; employee: SiPerson }): number {
  const pa = siPlaceParts(a.department);
  const pb = siPlaceParts(b.department);
  return (
    (pa.department === null ? 1 : 0) - (pb.department === null ? 1 : 0) ||
    (pa.department ?? '').localeCompare(pb.department ?? '') ||
    (pa.team === null ? 0 : 1) - (pb.team === null ? 0 : 1) ||
    (pa.team ?? '').localeCompare(pb.team ?? '') ||
    a.employee.fullNameEn.localeCompare(b.employee.fullNameEn) ||
    a.employee.employeeCode.localeCompare(b.employee.employeeCode)
  );
}

// ---------- the answers ----------

/** The department or team the views are filtered by, as the API names it back; null for everyone. */
export interface SiDepartmentFilter {
  id: string;
  nameEn: string;
  parent: { id: string; nameEn: string } | null;
}

interface SiReportBase {
  generatedAt: string;
  /** How many C-level people the view leaves out for the caller (owner, 19 October 2026); 0 for the CEO and a Super Admin. */
  confidentialExcluded: number;
  filters: { department: SiDepartmentFilter | null };
}

/** GET /payroll/social-insurance/register. */
export interface SiRegisterReport extends SiReportBase {
  view: 'register';
  /** The day in Cairo it is as of; the rates are this year's. */
  today: string;
  filters: SiReportBase['filters'] & { status: SiRegisterStatus };
  rates: SiRates;
  /** The basic wage Form 1 prints for someone with none of their own (the contract settings'). */
  insuranceBasicDefault: number;
  /** Whether the caller sees the national ID (HR and the CEO) and the employee file (Forms 1 and 6 and the print: HR and the CEO). */
  seesIdentity: boolean;
  seesFile: boolean;
  rows: SiRegisterRow[];
  totals: SiTotals;
  /** People under the labour law with the same filters who aren't registered, so aren't listed. */
  notRegistered: number;
}

/** GET /payroll/social-insurance/contributions. */
export interface SiContributionsReport extends SiReportBase {
  view: 'contributions';
  month: string;
  rates: SiRates;
  /** Whether payroll counts everyone under the labour law as insured, registered or not (Payroll Setup, 26 October 2026). */
  insureEveryone: boolean;
  rows: SiMonthRow[];
  totals: SiTotals & { joined: number; left: number };
  /** People under the labour law employed in the month who aren't registered, so aren't listed. */
  notRegistered: number;
}

/** GET /payroll/social-insurance/missing. */
export interface SiMissingReport extends SiReportBase {
  view: 'missing';
  today: string;
  /** Only those missing something, in the report's order. */
  rows: SiMissingRow[];
  /** Everyone checked (full-time employees, and the registered part-timers), complete ones too. */
  checked: number;
  byItem: Record<SiMissingItem, number>;
}

/** The month's totals, with how many joined and left in it. */
export function siMonthTotals(rows: readonly SiMonthRow[], month: string): SiContributionsReport['totals'] {
  const marks = rows.map((r) => siMonthMarks(r, month));
  return { ...siTotals(rows), joined: marks.filter((m) => m.joined).length, left: marks.filter((m) => m.left).length };
}
