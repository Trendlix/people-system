import { employmentStanding, type SiSource, type Standing } from '@trendlix/shared';
import { fromDateOnly } from '../../common/date-only.js';
import { employmentEnd } from '../../employees/employment-end.js';
import { INSURED_VERSION, insuredContractPay, insuredVersionOf, type InsuredVersion } from '../../employees/insured-wage.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { firstDay, lastDay } from '../months.js';

// What the Social Insurance report reads of each employment (owner, 27 October 2026: "is there a report for the social
// insurance? to be filled from the social insurance tab"; he chose all three: the register, the monthly contributions and
// the missing data): the person and their Social Insurance tab, where the employment places them, how it ends, and its
// signed contract versions, which the insured wage stands on when the employee has no comprehensive wage of their own.
// Pure code, tested in social-insurance-sources.spec.ts: the service reads the rows, these turn each into what
// packages/shared social-insurance-report.ts makes the rows from.

/** The endings that make Form 6 due, as the Employment tab offers it (documents.service.ts): not one rejected or withdrawn. */
export const LIVE_ENDINGS = ['pending_ceo', 'approved', 'completed'];

/** Social insurance Form 1 (joining) and Form 6 (leaving), as the documents keep them, and the print in the employee file. */
export const FORM_1 = 'insurance_form_1';
export const FORM_6 = 'insurance_form_6';
export const PRINT = 'insurance_print';

/**
 * An employment as the report reads it: its type, status and dates, its place, its live endings (an approved one's last
 * working day ends it for the month, as payroll ends it), its signed versions (never a draft), and its person with their
 * Social Insurance tab and national ID (sent only to those who see it).
 */
export const SI_EMPLOYMENT = {
  id: true,
  employeeId: true,
  employmentType: true,
  status: true,
  joinDate: true,
  endDate: true,
  departmentId: true,
  department: { select: { nameEn: true, parentId: true, parent: { select: { nameEn: true } } } },
  endings: { where: { status: { in: LIVE_ENDINGS } }, select: { status: true, lastWorkingDay: true } },
  contracts: { where: { status: { not: 'draft' } }, select: { ...INSURED_VERSION, status: true, endDate: true } },
  employee: {
    select: {
      id: true,
      employeeCode: true,
      fullNameEn: true,
      fullNameAr: true,
      insuranceNo: true,
      occupationCode: true,
      insuranceStartDate: true,
      insuranceBasicWage: true,
      insuranceComprehensiveWage: true,
      socialInsured: true,
      identity: { select: { nationalId: true } },
    },
  },
} satisfies Prisma.EmploymentSelect;

export type SiEmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof SI_EMPLOYMENT }>;

/** The employment's end, as payroll takes it: its end date, or an approved ending's last working day when earlier; null for neither. */
export function leftOnOf(e: Pick<SiEmploymentRow, 'endDate' | 'endings'>): string | null {
  const leaving = e.endings
    .filter((x) => x.status === 'approved')
    .map((x) => fromDateOnly(x.lastWorkingDay))
    .sort()[0];
  return employmentEnd(fromDateOnly(e.endDate), leaving ?? null);
}

/** Where the employment stands: Former once it has an end date, else its status (an intern's as Intern, as everywhere). */
export const standingOf = (e: Pick<SiEmploymentRow, 'endDate' | 'status' | 'employmentType'>): Standing => (e.endDate ? 'former' : employmentStanding(e));

/** Each person's employment the register and the checklist are about: the current one, else the one that started last. */
export function latestPerPerson<E extends Pick<SiEmploymentRow, 'employeeId' | 'joinDate' | 'endDate'>>(rows: readonly E[]): E[] {
  const chosen = new Map<string, E>();
  for (const e of rows) {
    const had = chosen.get(e.employeeId);
    const later = !had || (had.endDate !== null && e.endDate === null) || ((had.endDate === null) === (e.endDate === null) && e.joinDate > had.joinDate);
    if (later) chosen.set(e.employeeId, e);
  }
  return [...chosen.values()];
}

/** In the department or team asked (a department with its teams); everyone when none is asked. */
export const inPlace = (e: Pick<SiEmploymentRow, 'departmentId' | 'department'>, departmentId: string | null | undefined): boolean =>
  !departmentId || e.departmentId === departmentId || e.department?.parentId === departmentId;

/** A signed version as the insured wage reads it, with its status and term. */
type Version = InsuredVersion & { id: string; status: string; startDate: string; endDate: string | null };

/** The version in force latest within the days from `from` to `to` (the latest start, then the highest version); null for none. */
export function versionIn<V extends { startDate: string; endDate: string | null; version: number }>(versions: readonly V[], from: string, to: string): V | null {
  return versions.filter((v) => v.startDate <= to && (v.endDate === null || v.endDate >= from)).sort((a, b) => b.startDate.localeCompare(a.startDate) || b.version - a.version)[0] ?? null;
}

/** For the register, as of a day (today); for the contributions, a month (YYYY-MM). */
export type PayOn = { today: string } | { month: string };

/**
 * The contract pay (gross and allowances a month) the insured wage stands on, when the employee has no comprehensive
 * wage of their own (owner's decisions, 16 October 2026), after a raise the pay before it until its insured-wage date
 * (insured-wage.ts insuredContractPay). On the register, as the Social Insurance tab shows it today: a current
 * employment's newest signed version (a leaver's, the one in force on their last day, as the tab no longer has a signed
 * contract for them). For a month, as payroll takes it: the version in force latest in the days of the month employed,
 * its insured wage as of the month's 1st. Null without a signed version.
 */
export function contractPayOf(e: Pick<SiEmploymentRow, 'contracts' | 'joinDate' | 'endDate' | 'endings'>, on: PayOn): number | null {
  const versions: Version[] = e.contracts.map((c) => ({ ...insuredVersionOf(c), status: c.status, startDate: fromDateOnly(c.startDate), endDate: fromDateOnly(c.endDate) }));
  const joined = fromDateOnly(e.joinDate);
  const end = leftOnOf(e);
  if ('today' in on) {
    const day = end !== null && end < on.today ? end : on.today;
    const active = e.endDate === null ? versions.filter((v) => v.status === 'active').sort((a, b) => b.version - a.version)[0] : undefined;
    return insuredContractPay(active ?? versionIn(versions, joined, day), versions, day).total;
  }
  const from = firstDay(on.month);
  const to = lastDay(on.month);
  const signed = versionIn(versions, joined > from ? joined : from, end !== null && end < to ? end : to);
  return insuredContractPay(signed, versions, from).total;
}

/** The national ID as the caller has it (`shown`: masked on the screen, in full in a workbook, null when not theirs). */
type NationalId = (nationalId: string | null) => string | null;

/** What the shared rows are made from: the person, their tab, the employment, the contract pay, and the file when seen. */
export function sourceOf(e: SiEmploymentRow, on: PayOn, shown: NationalId, file: SiSource['file']): SiSource {
  const p = e.employee;
  return {
    employee: { id: p.id, employeeCode: p.employeeCode, fullNameEn: p.fullNameEn, fullNameAr: p.fullNameAr },
    tab: {
      insuranceNo: p.insuranceNo,
      occupationCode: p.occupationCode,
      insuranceStartDate: fromDateOnly(p.insuranceStartDate),
      insuranceBasicWage: p.insuranceBasicWage?.toNumber() ?? null,
      insuranceComprehensiveWage: p.insuranceComprehensiveWage?.toNumber() ?? null,
      socialInsured: p.socialInsured,
    },
    nationalId: shown(p.identity?.nationalId ?? null),
    employment: {
      id: e.id,
      employmentType: e.employmentType,
      standing: standingOf(e),
      joinDate: fromDateOnly(e.joinDate),
      leftOn: leftOnOf(e),
      endingRecorded: e.endDate !== null || e.endings.length > 0,
      department: e.department && { nameEn: e.department.nameEn, parent: e.department.parent && { nameEn: e.department.parent.nameEn } },
    },
    contractPay: contractPayOf(e, on),
    file,
  };
}
