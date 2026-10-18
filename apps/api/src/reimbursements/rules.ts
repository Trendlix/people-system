import { amountCounted, mayClaimReimbursement, sumAmounts, type ReimbursementRules, type ReimbursementUse } from '@trendlix/shared';

// A reimbursement type's conditions as the API applies them (owner, 18 October 2026: "allow the employee to add
// reimbursement request … for specific preset up conditions", and "in the setup i need to enter for it a cap"): who may
// claim it, what the employee's claims already take of its caps, how its caps fit together, and the reason the payroll
// addition is entered with. Pure code: the rules themselves are packages/shared reimbursements.ts.

/** Where the employee is: their current employment's department (a team, or a department) and the department a team is in. */
export interface ClaimantPlace {
  departmentId: string | null;
  /** The department the team is in; null for a department, or no place. */
  parentDepartmentId: string | null;
  gradeId: string | null;
  employmentType: string | null;
}

/**
 * Whether the employee may claim the type (mayClaimReimbursement): a department chosen takes its teams with it, so the
 * member of a team may claim a type chosen for the team or for its department.
 */
export function mayClaimType(rules: Pick<ReimbursementRules, 'departmentIds' | 'gradeIds' | 'employmentTypes'>, place: ClaimantPlace): boolean {
  const who = { departmentId: place.departmentId, gradeId: place.gradeId, employmentType: place.employmentType };
  if (mayClaimReimbursement(rules, who)) return true;
  return place.parentDepartmentId !== null && mayClaimReimbursement(rules, { ...who, departmentId: place.parentDepartmentId });
}

/** A claim of the type as its caps count it. */
export interface CountedClaim {
  status: string;
  amount: number;
  approvedAmount: number | null;
  /** YYYY-MM-DD */
  expenseDate: string;
}

/**
 * What the employee's claims of a type take of its caps in the month and the year of `expenseDate` (YYYY-MM-DD), by
 * their expenses' dates: each as amountCounted says (none rejected or cancelled).
 */
export function useOf(claims: readonly CountedClaim[], expenseDate: string): ReimbursementUse {
  const [year, month] = [expenseDate.slice(0, 4), expenseDate.slice(0, 7)];
  const inYear = claims.filter((c) => c.expenseDate.slice(0, 4) === year);
  return {
    usedInMonth: sumAmounts(inYear.filter((c) => c.expenseDate.slice(0, 7) === month).map(amountCounted)),
    usedInYear: sumAmounts(inYear.map(amountCounted)),
  };
}

const egp = (n: number) => `EGP ${n.toFixed(2)}`;

/**
 * Why a type's caps don't fit together, or null: a claim's cap no more than a month's or a year's, a month's no more
 * than a year's (each when both are set).
 */
export function capsProblem(c: Pick<ReimbursementRules, 'capPerClaim' | 'capPerMonth' | 'capPerYear'>): string | null {
  const over = (a: number | null, b: number | null) => a !== null && b !== null && Math.round(a * 100) > Math.round(b * 100);
  if (over(c.capPerClaim, c.capPerMonth)) return `The cap a claim (${egp(c.capPerClaim!)}) can't be more than the cap a month (${egp(c.capPerMonth!)}).`;
  if (over(c.capPerMonth, c.capPerYear)) return `The cap a month (${egp(c.capPerMonth!)}) can't be more than the cap a year (${egp(c.capPerYear!)}).`;
  if (over(c.capPerClaim, c.capPerYear)) return `The cap a claim (${egp(c.capPerClaim!)}) can't be more than the cap a year (${egp(c.capPerYear!)}).`;
  return null;
}

/** The reason an addition takes at most, as Additions / Deductions takes it (adjustments.dto.ts). */
export const ADDITION_REASON_MAX = 500;

/** The reason the Reimbursement addition is entered with: "<type>: <what it was for>", within what an addition takes. */
export function additionReason(typeName: string, description: string): string {
  const reason = `${typeName}: ${description}`.replace(/\s+/g, ' ').trim();
  const chars = Array.from(reason);
  return chars.length <= ADDITION_REASON_MAX ? reason : `${chars.slice(0, ADDITION_REASON_MAX - 1).join('').trimEnd()}…`;
}
