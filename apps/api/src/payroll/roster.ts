import {
  insuredWageVersion,
  lawRatesFor,
  paidDaysOf,
  shiftDaysIn,
  shiftExpectedHours,
  shiftWorkHours,
  type EmploymentType,
  type LawRates,
  type PayBasis,
  type PayrollRules,
  type PayrollSegment,
  type PayrollTerms,
} from '@trendlix/shared';
import { addDays } from '../common/date-only.js';
import { departmentName } from '../contracts/views.js';
import { insuredWageOfEmployee } from '../employees/insured-wage.js';
import { firstDay, lastDay } from './months.js';

// Who is on a month's payroll (owner's decisions, 16 October 2026): every employment that touches the month (joined by
// its last day, not ended before its first) whose person has a signed contract in force in the month, taken as far as
// the employment ran. The others are left out, with the reason, for HR to see. The month is paid for the days both
// employed and under a signed contract, each day under the one in force on it (owner, 17 October 2026: "take into
// consideration the start and end date of the contract if it is in the middle of the billing period"): a renewal
// mid-month splits it into two parts, each paid on its own contract's pay (the terms' segments), and days between two
// contracts or after one ends aren't paid. The line is the contract's at the month's end: its pay is the terms', and
// the insured wage (a whole month's) stands on it. A working day's hours are the employment's shift's, what a no-show
// or leave day takes out of the expected hours (owner's decisions, 16 and 17 October 2026): its hours to work a day,
// else its whole window (owner, 16 October 2026: "my company shift is to maintain 9 hours within the shift window, its
// like flexible shift"). The month's shift hours of someone paid monthly (owner's request, 16 October 2026, Payroll
// Setup): its working days within the days paid, less the official holidays on them, × those hours a day; none without
// a shift, nor for pay by the hour. Less the no-show and leave days, the pay counts them unless HR types the expected
// hours (payroll.ts expectedHoursOf).

/** An employment as the roster reads it, with its signed contracts that may be in force in the month. */
export interface RosterEmployment {
  id: string;
  employmentType: EmploymentType;
  joinDate: string;
  endDate: string | null;
  department: { nameEn: string; parent: { nameEn: string } | null } | null;
  jobTitle: string | null;
  /**
   * The employment's shift: its times, "HH:mm", its hours to work a day (null: the whole window) and its working days,
   * 0 = Sunday … 6 = Saturday; null without one.
   */
  shift: { startTime: string; endTime: string; hoursPerDay?: number | null; workingDays: readonly number[] } | null;
  employee: {
    id: string;
    employeeCode: string;
    fullNameEn: string;
    socialInsured: boolean;
    /** The employee's own comprehensive wage for social insurance, if any. */
    insuranceComprehensiveWage: number | null;
  };
  contracts: RosterContract[];
}

/** A signed contract (a version of the employment's) that may be in force in the month. */
export interface RosterContract {
  id: string;
  /** As it is shown: CON-2026-0007 (an amendment CON-2026-0007-A1). */
  number: string;
  startDate: string;
  endDate: string | null;
  payBasis: PayBasis;
  grossSalary: number;
  basicPercent: number;
  hourlyRate: number | null;
  allowances: { nameEn: string; amount: number; taxable: boolean; insured: boolean }[];
  /** Its number within the employment, and, for a raise, from when the insured wage follows its pay (raises.ts). */
  version: number;
  insuredWageFrom?: string | null;
}

/** Someone on the run: whose pay it is, what is shown with it, and what it is worked out from. */
export interface RosterLine {
  employeeId: string;
  employmentId: string;
  contractId: string;
  employeeCode: string;
  nameEn: string;
  department: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  payBasis: PayBasis;
  terms: PayrollTerms;
}

export interface Exclusion {
  employeeId: string;
  employeeCode: string;
  name: string;
  reason: string;
}

export const NO_CONTRACT = 'No signed contract for this month';
export const EARLIER_EMPLOYMENT = 'Left and was hired again this month: paid for the later employment only (add the earlier days as settlements)';

/** Departments in alphabetical order, no department last. */
export const byDepartment = (a: string | null, b: string | null) => (a === null ? 1 : 0) - (b === null ? 1 : 0) || (a ?? '').localeCompare(b ?? '');

/** The amounts in piasters, so the comprehensive wage is exact. */
const cents = (v: number) => Math.round(v * 100);

/**
 * The shift's hours a monthly-paid employment has in the month, and the days they come from: its working days in the
 * parts of the month paid (under a contract, 17 October 2026), less the holidays on them; null without a shift (or one
 * whose hours can't be told), and for pay by the hour.
 */
function shiftExpected(
  month: string,
  e: RosterEmployment,
  parts: readonly { from: string; to: string }[],
  payBasis: PayBasis,
  hoursPerDay: number | null,
  holidays: readonly string[],
) {
  if (payBasis !== 'monthly' || !e.shift || hoursPerDay === null) return { expectedHours: null, expectedDays: null };
  const days = { workingDays: 0, holidays: 0 };
  for (const p of parts) {
    const part = shiftDaysIn(month, p.from, p.to, e.shift.workingDays, holidays);
    days.workingDays += part.workingDays;
    days.holidays += part.holidays;
  }
  return { expectedHours: shiftExpectedHours(days, hoursPerDay), expectedDays: days };
}

/**
 * The parts of the days from `from` to `to` (YYYY-MM-DD) under each signed contract, in date order (owner, 17 October
 * 2026): each day under the contract in force on it, the latest start winning (a raise's amendment runs beside the
 * version it changes, from its 1st), consecutive days under the same one together. A day under none (between two
 * contracts, after one ends, before one starts) is in no part.
 */
export function contractParts(from: string, to: string, contracts: readonly RosterContract[]): { contract: RosterContract; from: string; to: string }[] {
  const parts: { contract: RosterContract; from: string; to: string }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const inForce = contracts
      .filter((c) => c.startDate <= day && (c.endDate === null || c.endDate >= day))
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.version - a.version)[0];
    const last = parts.at(-1);
    if (!inForce) continue;
    if (last && last.contract === inForce && addDays(last.to, 1) === day) last.to = day;
    else parts.push({ contract: inForce, from: day, to: day });
  }
  return parts;
}

/**
 * The run's people and those left out, from the employments that touch the month. A person with two employments in
 * the month (left and hired again) is paid on the later one; the earlier is listed as left out. `holidays` are the
 * official holidays' days (YYYY-MM-DD) in the month. `law`: the rates set by law the run is worked out with (its
 * year's), whose insurable limits the insured wage is kept within; the built-in ones of the year unless given.
 */
export function roster(
  month: string,
  employments: readonly RosterEmployment[],
  rules: Pick<PayrollRules, 'dayDivisor'>,
  holidays: readonly string[] = [],
  law: LawRates = lawRatesFor(Number(month.slice(0, 4))),
): { lines: RosterLine[]; exclusions: Exclusion[] } {
  const from = firstDay(month);
  const to = lastDay(month);
  const year = Number(month.slice(0, 4));
  const lines: RosterLine[] = [];
  const exclusions: Exclusion[] = [];
  const touching = employments.filter((e) => e.joinDate <= to && (e.endDate === null || e.endDate >= from));
  // the later employment first, so an earlier one of the same person is the one left out
  const ordered = [...touching].sort((a, b) => b.joinDate.localeCompare(a.joinDate) || a.employee.employeeCode.localeCompare(b.employee.employeeCode));
  const paid = new Set<string>();

  for (const e of ordered) {
    const p = e.employee;
    const out = (reason: string) => exclusions.push({ employeeId: p.id, employeeCode: p.employeeCode, name: p.fullNameEn, reason });
    if (paid.has(p.id)) {
      out(EARLIER_EMPLOYMENT);
      continue;
    }
    // the days employed in the month under each signed contract (owner, 17 October 2026); the line is the contract's at
    // the month's end
    const parts = contractParts(e.joinDate > from ? e.joinDate : from, e.endDate !== null && e.endDate < to ? e.endDate : to, e.contracts);
    if (!parts.length) {
      out(NO_CONTRACT);
      continue;
    }
    paid.add(p.id);
    const contract = parts[parts.length - 1].contract;
    const paidDays = paidDaysOf(month, parts, rules.dayDivisor);
    const allowancesOf = (c: RosterContract) => c.allowances.map((a) => ({ name: a.nameEn, amount: a.amount, taxable: a.taxable, insured: a.insured }));
    const segments: PayrollSegment[] = parts.map((part, i) => ({
      contractId: part.contract.id,
      number: part.contract.number,
      version: part.contract.version,
      from: part.from,
      to: part.to,
      days: paidDays[i],
      payBasis: part.contract.payBasis,
      gross: part.contract.grossSalary,
      basicPercent: part.contract.basicPercent,
      hourlyRate: part.contract.payBasis === 'hourly' ? part.contract.hourlyRate : null,
      allowances: allowancesOf(part.contract),
    }));

    const allowances = allowancesOf(contract);
    // after a raise the insured wage stands on the pay before it until its insured-wage date, the salary tax on the new
    // pay at once (owner's decision, 16 October 2026: "From the next January unless amended in Form 2")
    const insuredOn = insuredWageVersion(contract, e.contracts, from);
    const contractTotal = (cents(insuredOn.grossSalary) + insuredOn.allowances.reduce((sum, a) => sum + cents(a.amount), 0)) / 100;
    // the shift's hours to work a day, else its window
    const hoursPerDay = e.shift ? shiftWorkHours(e.shift) : null;
    lines.push({
      employeeId: p.id,
      employmentId: e.id,
      contractId: contract.id,
      employeeCode: p.employeeCode,
      nameEn: p.fullNameEn,
      department: departmentName(e.department),
      jobTitle: e.jobTitle,
      employmentType: e.employmentType,
      payBasis: contract.payBasis,
      terms: {
        year,
        payBasis: contract.payBasis,
        gross: contract.grossSalary,
        basicPercent: contract.basicPercent,
        hourlyRate: contract.payBasis === 'hourly' ? contract.hourlyRate : null,
        allowances,
        // the days employed under a contract: the divisor for a whole month (paidDaysOf)
        paidDays: paidDays.reduce((sum, n) => sum + n, 0),
        segments,
        // freelancers: no social insurance, no tax, no Martyrs' Fund
        statutory: e.employmentType !== 'freelance',
        insured: p.socialInsured,
        // as the Social Insurance tab shows it, for the run's year (its rates set by law)
        insuredWage: insuredWageOfEmployee(p.insuranceComprehensiveWage, contractTotal, law)!.amount,
        ...(insuredOn !== contract && p.insuranceComprehensiveWage === null && { insuredWageAsBefore: contract.insuredWageFrom }),
        hoursPerDay,
        ...shiftExpected(month, e, parts, contract.payBasis, hoursPerDay, holidays),
      },
    });
  }

  // by department (none last), then by name
  lines.sort((a, b) => byDepartment(a.department, b.department) || a.nameEn.localeCompare(b.nameEn));
  exclusions.sort((a, b) => a.name.localeCompare(b.name));
  return { lines, exclusions };
}
