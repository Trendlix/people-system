import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { changeInstallment, postponeInstallment, RECOVERY_TYPE, type AdvanceKind, type AdvanceSettleWay, type Installment } from '@trendlix/shared';
import { AuditService } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { toDateOnly, todayInCairo } from '../../common/date-only.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { firstDay, monthName } from '../months.js';
import type { ChangeInstallmentDto, CreateAdvanceDto, PostponeInstallmentDto, SettleAdvanceDto } from './adjustments.dto.js';
import { AdvancesService, kindWord } from './advances.service.js';
import { firstLocked, lockedMonths, payrollIs } from './locks.js';
import { byMonth, installmentReason, planChanges, renumbered, type SavedInstallment } from './plans.js';
import { RunAdjustmentsService } from './run-adjustments.service.js';
import { ADJUSTMENT, ADVANCE, balanceOf, monthOfDate, type AdvanceRow, type AdvanceView } from './views.js';

/** What the plan form warns with (owner, 18 October 2026): the employee's pay, Payroll Setup's share, and their installments by month. */
export interface InstallmentLimit {
  /** The current contract's monthly gross; null without one. */
  gross: number | null;
  /** Payroll Setup's "Installments warning at % of pay"; null: no warning. */
  percent: number | null;
  /** The employee's installments (pending and applied) of every open advance and loan, by month (YYYY-MM). */
  byMonth: Record<string, number>;
}

// The installments of advances and loans (owner, 18 October 2026: "in the deductions i might have a loan of a medical
// subscription or something that needs to be deducted as installments on the employee. how will it be managed?"; his
// answers the same day): made at once when one is recorded with a plan (AdvancesService.create), each month's run then
// taking that month's. HR may move one to a later month (it and every later one move a month on: postponeInstallment)
// or change one's amount (the later ones share what is left, a lowered last one adds a month: changeInstallment), only
// the pending ones in months whose run isn't with the CEO, approved or paid; an applied one never changes. Settling one
// says how (on leaving: "taken from the final settlement, unless waived", the owner's words; or paid back otherwise),
// and cancels the installments still pending. A warning, never a block, when a month's installments pass Payroll
// Setup's share of the pay (installmentLimitWarning, worked out by the web from limit()). Every change is in the audit
// log, the amounts only as set or changed, as for a salary.
@Injectable()
export class InstallmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly advances: AdvancesService,
    private readonly runs: RunAdjustmentsService,
  ) {}

  /** Records one (AdvancesService.create), then works out again the draft runs of its installments' months. */
  async create(dto: CreateAdvanceDto, user: SessionUser): Promise<AdvanceView> {
    const made = await this.advances.create(dto, user);
    if (made.installments.length) await this.runs.syncDrafts(made.installments.map((i) => i.month), [made.employee.id], user);
    return made;
  }

  /** Moves the installment of `month` to the month after, and every later pending one a month on. */
  async postpone(id: string, dto: PostponeInstallmentDto, user: SessionUser): Promise<AdvanceView> {
    const row = await this.advances.row(id);
    this.advances.assertOpen(row, 'changed');
    const { pending } = await this.changeable(row, dto.month, 'moved');
    const { update } = planChanges(pending, postponeInstallment(pending, dto.month));
    await this.assertTakes(update.map((u) => u.month), 'moved to');
    const from = new Map(pending.map((p) => [p.id, p.month]));
    await this.prisma.$transaction(update.map((u) => this.prisma.payrollAdjustment.update({ where: { id: u.id }, data: { month: toDateOnly(firstDay(u.month)) } })));
    for (const u of update) {
      await this.audit.record({
        userId: user.id,
        action: 'move',
        entityType: ADJUSTMENT,
        entityId: u.id,
        diff: { employeeCode: row.employee.employeeCode, kind: 'deduction', type: RECOVERY_TYPE[row.kind as AdvanceKind], month: { from: from.get(u.id), to: u.month }, advanceId: id },
      });
    }
    await this.audit.record({
      userId: user.id,
      action: 'postpone_installment',
      entityType: ADVANCE,
      entityId: id,
      diff: { employeeCode: row.employee.employeeCode, month: dto.month, moved: update.length },
    });
    await this.runs.syncDrafts([...update.map((u) => from.get(u.id)!), ...update.map((u) => u.month)], [row.employeeId], user);
    return this.advances.get(id);
  }

  /** Changes the installment of `month` to `amount`: the later pending ones share what is left of their total. */
  async change(id: string, dto: ChangeInstallmentDto, user: SessionUser): Promise<AdvanceView> {
    const row = await this.advances.row(id);
    const kind = row.kind as AdvanceKind;
    this.advances.assertOpen(row, 'changed');
    const { pending } = await this.changeable(row, dto.month, 'changed');
    const changed = changeInstallment(pending, dto.month, dto.amount);
    if ('problem' in changed) throw new BadRequestException(changed.problem);
    const { update, create, cancel } = planChanges(pending, changed.plan);
    if (!update.length && !create.length && !cancel.length) return this.advances.get(id);
    const was = new Map(pending.map((p) => [p.id, p]));
    await this.assertTakes([...update.filter((u) => u.month !== was.get(u.id)!.month).map((u) => u.month), ...create.map((c) => c.month)], 'added to');

    const type = RECOVERY_TYPE[kind];
    const { made, reasons } = await this.prisma.$transaction(async (tx) => {
      for (const u of update) await tx.payrollAdjustment.update({ where: { id: u.id }, data: { month: toDateOnly(firstDay(u.month)), amount: u.amount } });
      if (cancel.length) await tx.payrollAdjustment.updateMany({ where: { id: { in: cancel } }, data: { status: 'cancelled', cancelledById: user.id, cancelledAt: new Date() } });
      const added = create.length
        ? await tx.payrollAdjustment.createManyAndReturn({
            data: create.map((c) => ({
              employeeId: row.employeeId,
              month: toDateOnly(firstDay(c.month)),
              kind: 'deduction',
              type,
              taxed: false,
              amount: c.amount,
              // numbered below with the others
              reason: installmentReason(kind, 1, 1),
              advanceId: id,
              createdById: user.id,
            })),
            select: { id: true, month: true },
          })
        : [];
      // "2 of 7": numbered again once a month is added or taken off
      const all = await tx.payrollAdjustment.findMany({ where: { advanceId: id }, select: { id: true, month: true, status: true, reason: true } });
      const next = renumbered(
        kind,
        all.map((a) => ({ ...a, month: monthOfDate(a.month) })),
      );
      for (const [adjustmentId, reason] of next) await tx.payrollAdjustment.update({ where: { id: adjustmentId }, data: { reason } });
      return { made: added, reasons: next };
    });

    const code = row.employee.employeeCode;
    for (const u of update) {
      const before = was.get(u.id)!;
      const reason = reasons.get(u.id);
      await this.audit.record({
        userId: user.id,
        action: 'update',
        entityType: ADJUSTMENT,
        entityId: u.id,
        diff: {
          employeeCode: code,
          kind: 'deduction',
          ...(before.month !== u.month && { month: { from: before.month, to: u.month } }),
          ...(Math.round(before.amount * 100) !== Math.round(u.amount * 100) && { amount: 'changed' }),
          ...(reason && { reason: { from: before.reason, to: reason } }),
          advanceId: id,
        },
      });
    }
    for (const c of cancel) {
      const before = was.get(c)!;
      await this.audit.record({
        userId: user.id,
        action: 'cancel',
        entityType: ADJUSTMENT,
        entityId: c,
        diff: { employeeCode: code, month: before.month, kind: 'deduction', type, status: { from: 'pending', to: 'cancelled' }, advanceId: id },
      });
    }
    for (const m of made) {
      await this.audit.record({
        userId: user.id,
        action: 'create',
        entityType: ADJUSTMENT,
        entityId: m.id,
        diff: { employeeCode: code, month: monthOfDate(m.month), kind: 'deduction', type, taxed: false, amount: 'set', reason: reasons.get(m.id) ?? installmentReason(kind, 1, 1), advanceId: id },
      });
    }
    // the others whose number changed only
    const touched = new Set([...update.map((u) => u.id), ...made.map((m) => m.id)]);
    for (const [adjustmentId, reason] of reasons) {
      if (touched.has(adjustmentId) || !was.has(adjustmentId)) continue;
      await this.audit.record({
        userId: user.id,
        action: 'update',
        entityType: ADJUSTMENT,
        entityId: adjustmentId,
        diff: { employeeCode: code, kind: 'deduction', reason: { from: was.get(adjustmentId)!.reason, to: reason }, advanceId: id },
      });
    }
    await this.audit.record({
      userId: user.id,
      action: 'change_installment',
      entityType: ADVANCE,
      entityId: id,
      diff: { employeeCode: code, month: dto.month, amount: 'changed', installments: { from: pending.length, to: changed.plan.length } },
    });
    await this.runs.syncDrafts(
      [...pending.map((p) => p.month), ...changed.plan.map((p) => p.month)],
      [row.employeeId],
      user,
    );
    return this.advances.get(id);
  }

  /**
   * HR marks an open one settled, and how (18 October 2026): deducted from the final settlement, waived (with a note
   * why) or paid back (with a note how; the way an older caller settles one). Its installments still pending are
   * cancelled with it, but never one on a run with the CEO: the run is what the CEO approves.
   */
  async settle(id: string, dto: SettleAdvanceDto, user: SessionUser): Promise<AdvanceView> {
    const row = await this.advances.row(id);
    this.advances.assertOpen(row, 'settled');
    const how: AdvanceSettleWay = dto.how ?? 'paid_back';
    const note = dto.note ?? null;
    const pending = row.recoveries.filter((r) => r.status === 'pending').map((r) => ({ id: r.id, month: monthOfDate(r.month) }));
    const locked = await lockedMonths(this.prisma, pending.map((p) => p.month));
    const withCeo = pending.find((p) => locked.get(p.month) === 'pending_ceo');
    if (withCeo) {
      throw new ConflictException(
        `An installment of this ${kindWord(row.kind)} is on the ${monthName(withCeo.month)} payroll, which is with the CEO: ask the CEO to return the run, or settle it once the run is approved.`,
      );
    }
    const balance = balanceOf(row);
    const at = new Date();
    await this.prisma.$transaction([
      this.prisma.payrollAdjustment.updateMany({ where: { id: { in: pending.map((p) => p.id) }, status: 'pending' }, data: { status: 'cancelled', cancelledById: user.id, cancelledAt: at } }),
      this.prisma.payrollAdvance.update({ where: { id }, data: { status: 'settled', settledAt: at, settledById: user.id, settledNote: note, settledHow: how } }),
    ]);
    const type = RECOVERY_TYPE[row.kind as AdvanceKind];
    for (const p of pending) {
      await this.audit.record({
        userId: user.id,
        action: 'cancel',
        entityType: ADJUSTMENT,
        entityId: p.id,
        diff: { employeeCode: row.employee.employeeCode, month: p.month, kind: 'deduction', type, status: { from: 'pending', to: 'cancelled' }, advanceId: id },
      });
    }
    await this.audit.record({
      userId: user.id,
      action: 'settle',
      entityType: ADVANCE,
      entityId: id,
      diff: {
        employeeCode: row.employee.employeeCode,
        status: { from: 'open', to: 'settled' },
        how,
        note,
        outstanding: balance.outstanding > 0 ? 'some' : 'none',
        ...(pending.length && { installmentsCancelled: pending.length }),
      },
    });
    if (pending.length) await this.runs.syncDrafts(pending.map((p) => p.month), [row.employeeId], user);
    return this.advances.get(id);
  }

  /** The plan form's warning (owner, 18 October 2026): the employee's current gross, Payroll Setup's share, their installments by month. */
  async limit(employeeId: string): Promise<InstallmentLimit> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    const today = toDateOnly(todayInCairo());
    const [contract, settings, recoveries] = await Promise.all([
      // the signed contract of the employment that is current (or ends from today on)
      this.prisma.contract.findFirst({
        where: { status: 'active', employment: { employeeId, OR: [{ endDate: null }, { endDate: { gte: today } }] } },
        orderBy: { startDate: 'desc' },
        select: { grossSalary: true },
      }),
      this.prisma.payrollSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { installmentWarnPercent: true } }),
      this.prisma.payrollAdjustment.findMany({
        where: { employeeId, advance: { status: 'open' }, status: { in: ['pending', 'applied'] } },
        select: { month: true, amount: true, status: true },
      }),
    ]);
    const gross = contract?.grossSalary.toNumber() ?? null;
    return {
      gross: gross !== null && gross > 0 ? gross : null,
      percent: settings.installmentWarnPercent?.toNumber() ?? null,
      byMonth: byMonth(recoveries.map((r) => ({ month: monthOfDate(r.month), amount: r.amount?.toNumber() ?? 0, status: r.status }))),
    };
  }

  // ---------- helpers ----------

  /**
   * The pending installments HR may move or change, in month order, once the one of `month` is one of them: there is
   * one that month, still pending, and its month's run isn't with the CEO, approved or paid.
   */
  private async changeable(row: AdvanceRow, month: string, doing: string): Promise<{ pending: (Installment & Pick<SavedInstallment, 'id' | 'reason'>)[] }> {
    const word = kindWord(row.kind);
    const linked = row.recoveries
      .filter((r) => r.status !== 'cancelled')
      .map((r) => ({ id: r.id, month: monthOfDate(r.month), amount: r.amount?.toNumber() ?? 0, status: r.status, reason: r.reason }));
    const at = linked.find((r) => r.month === month);
    if (!at) throw new BadRequestException(`This ${word} has no installment in ${monthName(month)}.`);
    if (at.status !== 'pending') throw new ConflictException(`The ${monthName(month)} installment is applied, so it can't be ${doing}.`);
    const locked = await lockedMonths(this.prisma, linked.filter((r) => r.status === 'pending').map((r) => r.month));
    const status = locked.get(month);
    if (status) throw new ConflictException(`${payrollIs(month, status)}, so its installment can't be ${doing}.`);
    return { pending: linked.filter((r) => r.status === 'pending' && !locked.has(r.month)).map((r) => ({ id: r.id, month: r.month, amount: r.amount, reason: r.reason })) };
  }

  /** The months an installment is moved to or added in must not be with the CEO, approved or paid. */
  private async assertTakes(months: readonly string[], doing: string) {
    const locked = firstLocked(await lockedMonths(this.prisma, months));
    if (locked) throw new ConflictException(`${payrollIs(locked.month, locked.status)}, so an installment can't be ${doing} it.`);
  }
}
