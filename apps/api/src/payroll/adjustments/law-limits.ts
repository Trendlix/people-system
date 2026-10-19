import { BadRequestException } from '@nestjs/common';
import {
  addByMonth,
  installmentLimitProblem,
  LAW_INSTALLMENT_PERCENT,
  monthOverInstallmentLimit,
  planLimitProblem,
  RECOVERY_TYPE,
  type Installment,
} from '@trendlix/shared';
import { toDateOnly, todayInCairo } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { byMonth } from './plans.js';
import { monthOfDate } from './views.js';

// The Labour Law's limit on installments (Law No. 14 of 2025 Art. 113, read with the owner on 18 October 2026; owner,
// after reading the law: "Block above 10%"): a month's installments of advances and loans, all the employee's
// together, may take at most 10% of the wage, or the lower limit set in Payroll Setup. Recording a plan
// (advances.service.ts), changing or moving an installment (installments.service.ts) and entering, changing or moving
// a recovery by hand on Additions / Deductions (adjustments.service.ts) are refused when they take a month over it; a
// month already over it (planned before, or the pay changed) may still be lowered or moved, as long as no month rises
// over it. The wage is the employee's current signed contract's monthly gross: without one there is no wage to check,
// and nothing is refused. An unpaid intern's internship agreement (owner, 19 October 2026: "we are not paying them
// salary, its just transportation allowance") pays no wage, the gross 0, so there is no pay to take installments from:
// none are allowed, said plainly rather than as a percent of nothing. The rules are packages/shared installments.ts.

/** The deduction types that recover an advance or loan: their installments. */
export const INSTALLMENT_TYPES: readonly string[] = Object.values(RECOVERY_TYPE);

/** Why someone whose current contract pays no wage (an unpaid intern's) has no installments. */
const NO_WAGE = 'The current contract pays no wage (an unpaid internship), so there is no pay to take installments of advances and loans from';
/** A plan refused for no wage, and a change or a recovery by hand. */
export const NO_WAGE_PLAN = `${NO_WAGE}: record it without installments, to be paid back otherwise.`;
export const NO_WAGE_CHANGE = `${NO_WAGE}: settle the advance or loan as paid back otherwise.`;

/**
 * The wage the law's limits are worked out on: the current signed contract's monthly gross, 0 for one that pays no wage
 * (an unpaid intern's); null without one.
 */
export async function currentGross(db: Prisma.TransactionClient, employeeId: string): Promise<number | null> {
  const today = toDateOnly(todayInCairo());
  // the signed contract of the employment that is current (or ends from today on)
  const contract = await db.contract.findFirst({
    where: { status: 'active', employment: { employeeId, OR: [{ endDate: null }, { endDate: { gte: today } }] } },
    orderBy: { startDate: 'desc' },
    select: { grossSalary: true },
  });
  const gross = contract?.grossSalary.toNumber() ?? null;
  return gross !== null && gross >= 0 ? gross : null;
}

/** Payroll Setup's limit on a month's installments, in percent of the wage: at most the law's 10%. */
export async function installmentLimitPercent(db: Prisma.TransactionClient): Promise<number> {
  const settings = await db.payrollSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { installmentLimitPercent: true } });
  return Math.min(LAW_INSTALLMENT_PERCENT, settings.installmentLimitPercent.toNumber());
}

/** The employee's installments by month (YYYY-MM), with their ids: their recoveries of advances and loans, pending or applied. */
async function installmentRows(db: Prisma.TransactionClient, employeeId: string): Promise<{ id: string; month: string; amount: number; status: string }[]> {
  const rows = await db.payrollAdjustment.findMany({
    where: { employeeId, kind: 'deduction', type: { in: [...INSTALLMENT_TYPES] }, status: { in: ['pending', 'applied'] } },
    select: { id: true, month: true, amount: true, status: true },
  });
  return rows.map((r) => ({ id: r.id, month: monthOfDate(r.month), amount: r.amount?.toNumber() ?? 0, status: r.status }));
}

/** The employee's installments by month (YYYY-MM): all their advances and loans together, pending and applied. */
export async function installmentsByMonth(db: Prisma.TransactionClient, employeeId: string): Promise<Record<string, number>> {
  return byMonth(await installmentRows(db, employeeId));
}

/**
 * Refuses (400) a new plan of installments that takes a month of the employee's over the limit, saying the month, its
 * installments and the limit, and how many months would do.
 */
export async function assertPlanWithinLimit(db: Prisma.TransactionClient, employeeId: string, plan: readonly Installment[]): Promise<void> {
  if (!plan.length) return;
  const [gross, percent, others] = await Promise.all([currentGross(db, employeeId), installmentLimitPercent(db), installmentsByMonth(db, employeeId)]);
  if (gross === null) return;
  // no wage, no installments (an unpaid intern's internship agreement, 19 October 2026)
  if (gross === 0) throw new BadRequestException(NO_WAGE_PLAN);
  const problem = planLimitProblem(plan, others, gross, percent);
  if (problem) throw new BadRequestException(problem);
}

/**
 * Refuses (400) a change of the employee's installments that takes a month over the limit: `changed`, the ids of the
 * installments changed, moved, cancelled or replaced (left out of what they have); `planned`, those of them still to
 * be deducted as they would be, with any added. `instead` says what to do instead.
 */
export async function assertInstallmentLimit(
  db: Prisma.TransactionClient,
  employeeId: string,
  changed: readonly string[],
  planned: readonly Installment[],
  instead?: string,
): Promise<void> {
  const [gross, percent, rows] = await Promise.all([currentGross(db, employeeId), installmentLimitPercent(db), installmentRows(db, employeeId)]);
  if (gross === null) return;
  const out = new Set(changed);
  const before = byMonth(rows);
  const after = addByMonth(byMonth(rows.filter((r) => !out.has(r.id))), planned);
  const over = monthOverInstallmentLimit(before, after, gross, percent);
  // with no wage the limit is 0: any month that rises is over it, said plainly
  if (over) throw new BadRequestException(gross === 0 ? NO_WAGE_CHANGE : installmentLimitProblem(over.month, over.installments, gross, percent, instead));
}
