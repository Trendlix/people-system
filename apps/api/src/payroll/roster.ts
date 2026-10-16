import { paidDaysIn, type EmploymentType, type PayBasis, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import { departmentName } from '../contracts/views.js';
import { insuredWageOfEmployee } from '../employees/insured-wage.js';
import { firstDay, lastDay } from './months.js';

// Who is on a month's payroll (owner's decisions, 16 October 2026): every employment that touches the month (joined by
// its last day, not ended before its first) whose person has a signed contract in force in the month, taken as far as
// the employment ran. With two (a renewal starting mid-month) the later one's terms are paid for the whole month. The
// others are left out, with the reason, for HR to see.

/** An employment as the roster reads it, with its signed contracts that may be in force in the month. */
export interface RosterEmployment {
  id: string;
  employmentType: EmploymentType;
  joinDate: string;
  endDate: string | null;
  department: { nameEn: string; parent: { nameEn: string } | null } | null;
  jobTitle: string | null;
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
 * The run's people and those left out, from the employments that touch the month. A person with two employments in
 * the month (left and hired again) is paid on the later one; the earlier is listed as left out.
 */
export function roster(month: string, employments: readonly RosterEmployment[], rules: Pick<PayrollRules, 'dayDivisor'>): { lines: RosterLine[]; exclusions: Exclusion[] } {
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
        // as the Social Insurance tab shows it, for the run's year
        insuredWage: insuredWageOfEmployee(p.insuranceComprehensiveWage, contractTotal, year)!.amount,
      },
    });
  }

  // by department (none last), then by name
  lines.sort((a, b) => byDepartment(a.department, b.department) || a.nameEn.localeCompare(b.nameEn));
  exclusions.sort((a, b) => a.name.localeCompare(b.name));
  return { lines, exclusions };
}
