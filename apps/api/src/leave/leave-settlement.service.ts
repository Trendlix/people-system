import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { adjustmentTaxed, annualUnused, LEAVE_PAYOUT_TYPE, leavePayAmount, reimbursementPayMonth, type AdjustmentStatus } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, todayInCairo, toDateOnly } from '../common/date-only.js';
import { RunAdjustmentsService } from '../payroll/adjustments/run-adjustments.service.js';
import { ADJUSTMENT } from '../payroll/adjustments/views.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LeaveBalancesService, type YearFigures } from './leave-balances.service.js';

const SETTLEMENT = 'final_settlement';

/** The unused annual leave of an ended employment, as its final settlement lists it ("Unused leave to pay"). */
export interface UnusedLeaveView {
  /** The year of the last working day, whose balance it is. */
  year: number;
  /** The days unused on the last working day: earned to then, carried in and adjusted, less what was approved. */
  days: number;
  /** A day's pay: the gross in force on the last working day ÷ the payroll's day divisor. */
  dayRate: number;
  amount: number;
  /** Once HR recorded it paid: the Unused leave paid addition, as Additions / Deductions has it now. */
  paid: { adjustmentId: string; month: string; status: AdjustmentStatus; days: number; amount: number } | null;
}

// The unused annual leave paid on leaving (Labour Law 14/2025 Art. 125: "فإذا انتهت علاقة العمل قبل استنفاد العامل رصيد
// إجازته السنوية استحق الأجر المقابل لهذا الرصيد"; owner, 18 October 2026: "can you apply the leaves according to the
// law?"): an ended employment's final settlement lists the days unused on its last working day (what the year earned to
// then, Art. 124, with what was carried in and adjusted, less the leave approved from it), the day rate and the amount.
// HR records it paid: an Unused leave paid addition, taxed, on the payroll of the final month (the last working day's),
// or the first month after it whose run isn't approved or paid; the year's balance is closed with it. An addition HR
// cancelled since can be recorded again. Every step is in the audit log, the amount only as set.
@Injectable()
export class LeaveSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly balances: LeaveBalancesService,
    private readonly runs: RunAdjustmentsService,
  ) {}

  /** Each ended employment's unused leave, by employment id; none for one not ended. */
  async unused(employmentIds: readonly string[]): Promise<Map<string, UnusedLeaveView>> {
    const employments = (await this.balances.employments(employmentIds)).filter((e) => e.endDate !== null);
    const out = new Map<string, UnusedLeaveView>();
    if (!employments.length) return out;
    const pairs = employments.map((employment) => ({ employment, year: Number(employment.endDate!.slice(0, 4)) }));
    const figures = new Map<string, YearFigures>();
    // each as on its own last working day, so leave booked after it isn't taken from it
    for (const p of pairs) {
      const f = (await this.balances.yearFigures([p], p.employment.endDate!)).get(`${p.employment.id}:${p.year}`);
      if (f) figures.set(p.employment.id, f);
    }
    const rates = new Map<string, number>();
    for (const e of employments) for (const [id, rate] of await this.balances.dayRates([e.id], e.endDate!)) rates.set(id, rate);
    const payoutIds = [...figures.values()].flatMap((f) => (f.closed?.on === 'leaving' && f.closed.payoutAdjustmentId ? [f.closed.payoutAdjustmentId] : []));
    const payouts = payoutIds.length
      ? new Map(
          (await this.prisma.payrollAdjustment.findMany({ where: { id: { in: payoutIds } }, select: { id: true, month: true, status: true, amount: true } })).map((a) => [a.id, a]),
        )
      : new Map();
    for (const { employment: e, year } of pairs) {
      const f = figures.get(e.id);
      if (!f) continue;
      const closed = f.closed?.on === 'leaving' ? f.closed : null;
      const days = closed ? closed.unused : Math.max(0, annualUnused(f));
      const dayRate = closed?.dayRate ?? rates.get(e.id) ?? 0;
      const payout = closed?.payoutAdjustmentId ? payouts.get(closed.payoutAdjustmentId) : null;
      out.set(e.id, {
        year,
        days,
        dayRate,
        amount: leavePayAmount(days, dayRate),
        paid: payout
          ? { adjustmentId: payout.id, month: fromDateOnly(payout.month).slice(0, 7), status: payout.status as AdjustmentStatus, days: closed!.paidOut, amount: payout.amount?.toNumber() ?? 0 }
          : null,
      });
    }
    return out;
  }

  /** HR records an ended employment's unused leave paid: an Unused leave paid addition in the final month (or the next open one). */
  async pay(employmentId: string, user: SessionUser): Promise<void> {
    const employment = (await this.balances.employments([employmentId]))[0];
    if (!employment) throw new NotFoundException('Employment not found.');
    const name = employment.employee.fullNameEn;
    if (!employment.endDate) throw new ConflictException(`${name}'s employment hasn't ended, so there is no unused leave to pay yet.`);
    if (employment.endDate > todayInCairo()) throw new ConflictException(`${name}'s employment ends on ${shownDate(employment.endDate)}: the unused leave is paid from then.`);
    const view = (await this.unused([employmentId])).get(employmentId);
    if (!view) throw new NotFoundException('Employment not found.');
    if (view.paid && view.paid.status !== 'cancelled') throw new ConflictException(`${name}'s unused leave is recorded as paid already, with the ${view.paid.month} payroll.`);
    if (!(view.days > 0)) throw new ConflictException(`${name} has no unused annual leave to pay.`);
    if (!(view.dayRate > 0)) throw new ConflictException(`${name} has no signed contract to work a day's pay out from, so the unused leave can't be paid here.`);
    const amount = leavePayAmount(view.days, view.dayRate);
    const reason = `Unused leave paid on leaving: ${view.days} ${view.days === 1 ? 'day' : 'days'} of ${view.year}`;
    const { adjustmentId, month, employeeCode } = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.payrollRun.findMany({ where: { status: { in: ['approved', 'paid'] } }, select: { month: true } });
      // the final month's payroll, or the first after it still open
      const month = reimbursementPayMonth(employment.endDate!, closed.map((r) => fromDateOnly(r.month)));
      const adjustment = await tx.payrollAdjustment.create({
        data: {
          employeeId: employment.employeeId,
          month: toDateOnly(month),
          kind: 'addition',
          type: LEAVE_PAYOUT_TYPE,
          taxed: adjustmentTaxed('addition', LEAVE_PAYOUT_TYPE, null) ?? true,
          amount,
          reason,
          createdById: user.id,
        },
        select: { id: true, employee: { select: { employeeCode: true } } },
      });
      const closing = {
        closedAt: new Date(),
        closedById: user.id,
        closedOn: 'leaving',
        unused: view.days,
        carriedOut: 0,
        paidOut: view.days,
        dayRate: view.dayRate,
        payoutAdjustmentId: adjustment.id,
      };
      await tx.leaveBalanceYear.upsert({
        where: { employmentId_year: { employmentId, year: view.year } },
        create: { employeeId: employment.employeeId, employmentId, year: view.year, ...closing },
        update: closing,
      });
      return { adjustmentId: adjustment.id, month: month.slice(0, 7), employeeCode: adjustment.employee.employeeCode };
    });
    await this.audit.record({
      userId: user.id,
      action: 'unused_leave_paid',
      entityType: SETTLEMENT,
      entityId: employmentId,
      diff: { employeeCode, year: view.year, days: view.days, amount: 'set', month, adjustmentId },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ADJUSTMENT,
      entityId: adjustmentId,
      diff: { employeeCode, month, kind: 'addition', type: LEAVE_PAYOUT_TYPE, taxed: true, amount: 'set', reason },
    });
    await this.runs.syncDrafts([month], [employment.employeeId], user);
  }
}
