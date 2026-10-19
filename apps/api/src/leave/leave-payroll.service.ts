import { Injectable } from '@nestjs/common';
import { PERMISSION_RULE_DEFAULTS, type LeavePay, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { json, savedInputs, worked } from '../payroll/line-work.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { leaveTermsOf, permissionTermsOf } from '../payroll/roster.js';
import { runLawRates } from '../payroll/views.js';

const LINE = 'payroll_line';

// The month's leave on its payroll (owner, 18 October 2026: "can you apply the leaves according to the law?"): a run takes
// each line's approved leave when it is made or refreshed (payroll/roster.ts leaveTermsOf), and a draft's line is worked
// out again whenever its employee's leave in the month is approved or cancelled, so the run HR sends to the CEO has its
// Leave days and Unpaid leave days as they are (unless HR typed others, which win). From the CEO's step on a run never
// changes. Permission requests (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", counted as
// worked) the same way: a draft's line takes the month's approved permission hours again whenever one is approved,
// recorded or cancelled (its Permission hours, unless HR typed others).
@Injectable()
export class LeavePayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Works out again the employee's lines on the draft runs of the months from `from` to `to` (YYYY-MM-DD) with their
   * approved leave and permission as they are now; a line whose leave and permission hours are the same is left as it
   * is. Every line changed is in the audit log.
   */
  async syncDrafts(employeeId: string, from: string, to: string, user: SessionUser | null): Promise<void> {
    const runs = await this.prisma.payrollRun.findMany({
      where: { status: 'draft', month: { gte: toDateOnly(firstDay(from.slice(0, 7))), lte: toDateOnly(firstDay(to.slice(0, 7))) } },
      include: { lines: { where: { employeeId } } },
    });
    for (const run of runs) {
      const line = run.lines[0];
      if (!line) continue;
      const month = fromDateOnly(run.month).slice(0, 7);
      const before = line.terms as unknown as PayrollTerms;
      const leave = before.payBasis === 'monthly' ? await this.monthLeave(line.employmentId, month, before) : null;
      const permissionHours = before.payBasis === 'monthly' ? await this.monthPermission(line.employmentId, month, before) : null;
      const sameLeave = JSON.stringify(before.leave ?? null) === JSON.stringify(leave);
      const samePermission = (before.permissionHours ?? null) === permissionHours;
      if (sameLeave && samePermission) continue;
      const terms: PayrollTerms = { ...before };
      delete terms.leave;
      delete terms.permissionHours;
      if (leave) terms.leave = leave;
      if (permissionHours !== null) terms.permissionHours = permissionHours;
      const rules = run.rules as unknown as PayrollRules;
      await this.prisma.payrollLine.update({ where: { id: line.id }, data: { terms: json(terms), ...worked(terms, savedInputs(line.inputs), rules, runLawRates(run)) } });
      await this.audit.record({
        userId: user?.id ?? null,
        action: 'update',
        entityType: LINE,
        entityId: line.id,
        diff: {
          runId: run.id,
          month,
          employeeCode: line.employeeCode,
          ...(!sameLeave && { leave: { from: before.leave ?? null, to: leave } }),
          ...(!samePermission && { permissionHours: { from: before.permissionHours ?? null, to: permissionHours } }),
        },
      });
    }
  }

  /**
   * The employment's approved permission hours in the month, as the run's roster takes them (roster.ts
   * permissionTermsOf): on the line's days paid, at most the Leave Setup's hours a month.
   */
  private async monthPermission(employmentId: string, month: string, terms: PayrollTerms): Promise<number | null> {
    const [first, last] = [firstDay(month), lastDay(month)];
    const [rows, setup, employment] = await Promise.all([
      this.prisma.permissionRequest.findMany({ where: { employmentId, status: 'approved', date: { gte: toDateOnly(first), lte: toDateOnly(last) } }, select: { date: true, hours: true } }),
      this.prisma.leaveSettings.findUnique({ where: { id: 1 }, select: { permissionHoursPerMonth: true } }),
      this.prisma.employment.findUnique({ where: { id: employmentId }, select: { joinDate: true, endDate: true } }),
    ]);
    if (!employment) return null;
    const joined = fromDateOnly(employment.joinDate);
    const ended = fromDateOnly(employment.endDate);
    const parts = terms.segments?.length
      ? terms.segments.map((s) => ({ from: s.from, to: s.to }))
      : [{ from: joined > first ? joined : first, to: ended !== null && ended < last ? ended : last }];
    return permissionTermsOf(
      month,
      parts,
      rows.map((r) => ({ date: fromDateOnly(r.date), hours: r.hours.toNumber() })),
      setup?.permissionHoursPerMonth.toNumber() ?? PERMISSION_RULE_DEFAULTS.hoursPerMonth,
    );
  }

  /** The employment's approved leave in the month, as the run's roster takes it, within the line's parts of the month. */
  private async monthLeave(employmentId: string, month: string, terms: PayrollTerms) {
    const [first, last] = [firstDay(month), lastDay(month)];
    const employment = await this.prisma.employment.findUnique({
      where: { id: employmentId },
      select: {
        joinDate: true,
        endDate: true,
        shift: { select: { workingDays: true } },
        leaveRequests: {
          where: { status: 'approved', startDate: { lte: toDateOnly(last) }, endDate: { gte: toDateOnly(first) } },
          select: { startDate: true, endDate: true, halfDay: true, type: { select: { paid: true, payPercent: true, calendarDays: true } } },
        },
      },
    });
    if (!employment) return null;
    const holidays = (await this.prisma.holiday.findMany({ where: { date: { gte: toDateOnly(first), lte: toDateOnly(last) } }, select: { date: true } })).map((h) => fromDateOnly(h.date));
    // the line's parts of the month under each contract; one made before them, the days employed
    const joined = fromDateOnly(employment.joinDate);
    const ended = fromDateOnly(employment.endDate);
    const parts = terms.segments?.length
      ? terms.segments.map((s) => ({ from: s.from, to: s.to }))
      : [{ from: joined > first ? joined : first, to: ended !== null && ended < last ? ended : last }];
    const leaves = employment.leaveRequests.map((l) => ({
      startDate: fromDateOnly(l.startDate),
      endDate: fromDateOnly(l.endDate),
      halfDay: l.halfDay,
      paid: l.type.paid as LeavePay,
      payPercent: l.type.payPercent?.toNumber() ?? null,
      calendarDays: l.type.calendarDays,
    }));
    return leaveTermsOf(month, parts, employment.shift?.workingDays, holidays, leaves, terms.paidDays);
  }
}
