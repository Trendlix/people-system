import {
  lawRatesFor,
  paidDaysIn,
  shiftDaysIn,
  shiftExpectedHours,
  shiftWorkHours,
  type EmploymentType,
  type LawRates,
  type PayBasis,
  type PayrollRules,
  type PayrollTerms,
} from '@trendlix/shared';
import { departmentName } from '../contracts/views.js';
import { insuredWageOfEmployee } from '../employees/insured-wage.js';
import { firstDay, lastDay } from './months.js';

// Who is on a month's payroll (owner's decisions, 16 October 2026): every employment that touches the month (joined by
// its last day, not ended before its first) whose person has a signed contract in force in the month, taken as far as
// the employment ran. With two (a renewal starting mid-month) the later one's terms are paid for the whole month. The
// others are left out, with the reason, for HR to see. A working day's hours are the employment's shift's, what a
// no-show day takes out of the expected hours (owner's decision, 16 October 2026): its hours to work a day, else its
// whole window (owner, 16 October 2026: "my company shift is to maintain 9 hours within the shift window, its like
// flexible shift"). The month's expected hours of someone paid monthly are the shift's too (owner's request, 16 October
// 2026, Payroll Setup): its working days within the days employed in the month, less the official holidays on them, ×
// those hours a day; none without a shift, nor for pay by the hour. The pay counts them unless HR types the expected
// hours.

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
  contracts: {
    id: string;
    startDate: string;
    endDate: string | null;
    payBasis: PayBasis;
    grossSalary: number;
    basicPercent: number;
    hourlyRate: number | null;
    allowances: { nameEn: string; amount: number; taxable: boolean; insured: boolean }[];
  }[];
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
 * The expected hours a monthly-paid employment's shift gives in the month, and the days they come from: null without a
 * shift (or one whose hours can't be told), and for pay by the hour.
 */
function shiftExpected(month: string, e: RosterEmployment, payBasis: PayBasis, hoursPerDay: number | null, holidays: readonly string[]) {
  if (payBasis !== 'monthly' || !e.shift || hoursPerDay === null) return { expectedHours: null, expectedDays: null };
  const days = shiftDaysIn(month, e.joinDate, e.endDate, e.shift.workingDays, holidays);
  return { expectedHours: shiftExpectedHours(days, hoursPerDay), expectedDays: days };
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
    // in force in the month, as far as the employment ran in it; the latest start wins
    const until = e.endDate !== null && e.endDate < to ? e.endDate : to;
    const contract = e.contracts
      .filter((c) => c.startDate <= until && (c.endDate === null || c.endDate >= from))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    if (!contract) {
      out(NO_CONTRACT);
      continue;
    }
    paid.add(p.id);

    const allowances = contract.allowances.map((a) => ({ name: a.nameEn, amount: a.amount, taxable: a.taxable, insured: a.insured }));
    const contractTotal = (cents(contract.grossSalary) + allowances.reduce((sum, a) => sum + cents(a.amount), 0)) / 100;
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
        paidDays: paidDaysIn(month, e.joinDate, e.endDate, rules.dayDivisor),
        // freelancers: no social insurance, no tax, no Martyrs' Fund
        statutory: e.employmentType !== 'freelance',
        insured: p.socialInsured,
        // as the Social Insurance tab shows it, for the run's year (its rates set by law)
        insuredWage: insuredWageOfEmployee(p.insuranceComprehensiveWage, contractTotal, law)!.amount,
        hoursPerDay,
        ...shiftExpected(month, e, contract.payBasis, hoursPerDay, holidays),
      },
    });
  }

  // by department (none last), then by name
  lines.sort((a, b) => byDepartment(a.department, b.department) || a.nameEn.localeCompare(b.nameEn));
  exclusions.sort((a, b) => a.name.localeCompare(b.name));
  return { lines, exclusions };
}
