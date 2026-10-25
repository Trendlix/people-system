import { isKpiLevel, kpiMonthForPayroll, type PayrollKpi, type PayrollTerms } from '@trendlix/shared';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { firstDay } from './months.js';

// The KPI a payroll line's variable part follows (owner, 21 October 2026: "Last month's KPI, this pay"; "As the sheet:
// full at 80%+"): the final scorecard of the month before the payroll's (October's opens on 1 November and counts in
// November's run), its final % and level, kept with the line's terms when a run is made or refreshed (a draft takes the
// KPI on refresh; a run with the CEO, approved or paid keeps its figures). Someone with none final: null, so the variable
// part isn't cut ("with no KPI given it isn't cut"). packages/shared payroll.ts kpiPayScore works the score out.
// Never a practice scorecard (owner, 22 October 2026: "never reaches payroll"): the real one only, so the payslips too.
// With whether its Attendance metric counted (owner, 25 October 2026: "Fixed cut only": not since, the KPI being
// performance only and attendance cut on the fixed part alone), which the payroll line and the payslip say.

type Db = PrismaService | Prisma.TransactionClient;

/** Each person's final scorecard of the month before `payrollMonth` (YYYY-MM), as a line's terms keep it. */
export async function finalKpis(db: Db, payrollMonth: string, employeeIds: readonly string[]): Promise<Map<string, PayrollKpi>> {
  const out = new Map<string, PayrollKpi>();
  if (!employeeIds.length) return out;
  const month = kpiMonthForPayroll(payrollMonth);
  const rows = await db.kpiScorecard.findMany({
    where: { month: toDateOnly(firstDay(month)), status: 'final', practice: false, employeeId: { in: [...employeeIds] } },
    select: { id: true, employeeId: true, month: true, finalPercent: true, level: true, attendanceCounted: true },
  });
  for (const r of rows) {
    if (r.finalPercent === null || !isKpiLevel(r.level)) continue;
    out.set(r.employeeId, { month: fromDateOnly(r.month).slice(0, 7), scorecardId: r.id, finalPercent: r.finalPercent.toNumber(), level: r.level, attendanceCounted: r.attendanceCounted });
  }
  return out;
}

/** The terms with last month's KPI (null: none final, not cut). */
export const withKpi = (terms: PayrollTerms, kpi: PayrollKpi | null | undefined): PayrollTerms => ({ ...terms, kpi: kpi ?? null });
