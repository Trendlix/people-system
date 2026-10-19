import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ADJUSTMENT_KIND_LABELS,
  ADJUSTMENT_STATUS_LABELS,
  ADVANCE_KIND_LABELS,
  adjustmentTaxed,
  damageLimitWarning,
  adjustmentTypeLabel,
  ENTERED_TYPES,
  isAdjustmentType,
  isDaysType,
  LEAVE_PAYOUT_TYPE,
  RECURRING_TYPE,
  recoveredKind,
  sumAmounts,
  type AdjustmentKind,
  type AdjustmentStatus,
  type AdvanceKind,
  type PayrollRules,
  type PayrollStatus,
} from '@trendlix/shared';
import { AuditService, changes } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../../common/date-only.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { firstDay, lastDay, monthName, monthsLater } from '../months.js';
import { STATUS_TEXT } from '../status.js';
import type { AdjustmentChoicesQueryDto, AdjustmentsQueryDto, CreateAdjustmentDto, MoveAdjustmentsDto, UpdateAdjustmentDto } from './adjustments.dto.js';
import { AdvancesService } from './advances.service.js';
import { assertInstallmentLimit } from './law-limits.js';
import { paidAmounts, RunAdjustmentsService } from './run-adjustments.service.js';
import { egp, employedIn, placeName, userNames } from './people.js';
import { ADJUSTMENT, ADJUSTMENT_INCLUDE, adjustmentView, balanceOf, personOf, type AdjustmentRow, type AdjustmentView, type AdvanceView, type PersonRef } from './views.js';

/** How far back and ahead an addition or deduction can be entered, in months: back as far as a run can be made, and a year ahead for a loan's installments. */
export const ADJUSTMENT_MONTHS_BACK = 12;
export const ADJUSTMENT_MONTHS_AHEAD = 12;

/** Why a Recurring deduction isn't entered by hand (owner, 18 October 2026): the month's run adds it. */
const RECURRING_BY_HAND =
  "A recurring deduction is added to each month's payroll by itself: set it up as a recurring deduction, or choose Other deduction for a one-off.";

/** Why unused leave paid isn't entered by hand (owner, 18 October 2026): Year Closing or the final settlement adds it. */
const LEAVE_PAYOUT_BY_HAND =
  'Unused leave is paid from Year Closing, or from the final settlement when someone leaves: it is not entered by hand. Choose Other addition for a one-off.';

/** What a recovery refused at the law's limit says to do instead (owner, 18 October 2026: "Block above 10%"). */
const RECOVERY_INSTEAD = 'Enter a smaller amount, and recover the rest in a later month.';

/** "a bonus", "an advance recovery", as a message says it. */
function typeWords(kind: string, type: string): string {
  const label = adjustmentTypeLabel(kind, type).toLowerCase();
  return `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`;
}

/** What the month's form offers: who can be paid that month, and their advances and loans still being recovered. */
export interface AdjustmentChoices {
  month: string;
  /** The month's run, if made; while it is with the CEO, approved or paid, nothing is changed for the month. */
  run: { id: string; status: PayrollStatus } | null;
  /** Why the month's additions and deductions can't be changed, or null. */
  locked: string | null;
  people: (PersonRef & { department: string | null })[];
  advances: AdvanceView[];
  /** The month's pending ones for people the month's run doesn't have (none without a run): no line takes them. */
  notOnRun: number;
  /**
   * Pending ones left on months whose run the CEO approved without them, oldest first: made before runs took them, or
   * for someone not on the run. HR moves them to a later month.
   */
  leftBehind: { month: string; count: number }[];
  /**
   * The month's warnings by the Labour Law, by employee (owner, 18 October 2026, after reading the law; warnings, never
   * blocks): damage or loss deductions past 5 days' wage (Art. 151).
   */
  warnings: { employeeId: string; text: string }[];
}

// Additions / Deductions (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Unsettled -
// Additions / Deductions"; asked, the owner chose one-off amounts per employee and month, not recurring): HR enters an
// addition or a deduction for someone employed in the month, of a type of its kind (packages/shared
// payroll-adjustments.ts), with the amount and the reason; an advance's recovery or a loan's installment is linked to
// the advance or loan, and never more than is left to recover of it. HR changes and cancels one while it is pending and
// the month's run is still a draft (or not made): from the CEO's step on, the run is what the CEO approves, as with the
// run's own figures. The month's run takes them when it is made or refreshed, and works a draft's line out again when
// one of its person's changes (run-adjustments.service.ts); the CEO's approval applies them. One left pending on a
// month approved without it (entered before runs took them, or for someone not on the run) is moved to a later month.
// HR, Finance and the CEO see them, like the payroll lines; every change is in the audit log, the amounts only as set
// or changed. The one place to enter them (owner, 17 October 2026, on the run's grid: "instead of there, i think
// earnings and deductions will be enough"): a Bonus (days) or a Penalty (days) is entered in days, its amount worked
// out by the month's run and shown as its line has it (an applied one with what the line paid); every other type in
// EGP. A Recurring deduction (owner, 18 October 2026: a monthly share, e.g. a medical subscription) is added by the
// month's run from the recurring deduction set up (recurring.service.ts), never entered here: HR may change its amount
// or reason, or cancel it, for that month (a month cancelled isn't added again), but not turn it into another type nor
// give its recurring deduction a second deduction in a month. An advance's recovery or a loan's installment entered,
// changed or moved here that would take the employee's installments in a month over the Labour Law's limit is refused
// (owner, 18 October 2026, after reading the law: "Block above 10%"; law-limits.ts). The month's damage or loss
// deductions past 5 days' wage are warned of (Art. 151, a warning only): choices().warnings.
@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly advances: AdvancesService,
    private readonly runs: RunAdjustmentsService,
  ) {}

  /**
   * The additions and deductions asked for, by month (newest first), then by employee code, then as entered; not the
   * C-level people's (`hidden`) for anyone but the CEO and a Super Admin (owner, 19 October 2026).
   */
  async list(query: AdjustmentsQueryDto, hidden: readonly string[] = []): Promise<AdjustmentView[]> {
    if (query.type && query.kind && !isAdjustmentType(query.kind, query.type)) throw new BadRequestException(this.typeMessage(query.kind));
    const rows = await this.prisma.payrollAdjustment.findMany({
      where: {
        AND: [{ employeeId: query.employeeId }, hidden.length ? { employeeId: { notIn: [...hidden] } } : {}],
        month: query.month ? toDateOnly(firstDay(query.month)) : undefined,
        kind: query.kind,
        type: query.type,
        status: query.status,
      },
      orderBy: [{ month: 'desc' }, { employee: { employeeCode: 'asc' } }, { createdAt: 'asc' }],
      include: ADJUSTMENT_INCLUDE,
    });
    return this.views(rows);
  }

  async get(id: string): Promise<AdjustmentView> {
    return (await this.views([await this.row(id)]))[0];
  }

  /**
   * The month's form: its run and whether it is locked, the people employed in it, and their open advances and loans;
   * without the C-level people (`hidden`) for anyone but the CEO and a Super Admin (owner, 19 October 2026).
   */
  async choices(query: AdjustmentChoicesQueryDto, hidden: readonly string[] = []): Promise<AdjustmentChoices> {
    const month = query.month;
    const shown = hidden.length ? { employeeId: { notIn: [...hidden] } } : {};
    const [run, employments] = await Promise.all([
      this.prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { id: true, status: true, rules: true } }),
      this.prisma.employment.findMany({
        where: { ...employedIn(month), ...shown },
        orderBy: [{ employee: { fullNameEn: 'asc' } }, { joinDate: 'desc' }],
        select: { employee: { select: { id: true, employeeCode: true, fullNameEn: true } }, department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } },
      }),
    ]);
    // someone employed twice in the month is listed once, with their latest employment's place
    const people = new Map<string, PersonRef & { department: string | null }>();
    for (const e of employments) if (!people.has(e.employee.id)) people.set(e.employee.id, { ...personOf(e.employee), department: placeName(e.department) });
    const [advances, notOnRun, leftBehind, warnings] = await Promise.all([
      this.advances.list({ status: 'open' }, hidden),
      run
        ? this.prisma.payrollAdjustment.count({ where: { month: toDateOnly(firstDay(month)), status: 'pending', employee: { payrollLines: { none: { runId: run.id } } }, ...shown } })
        : 0,
      this.leftBehind(hidden),
      this.damageWarnings(month, (run?.rules as PayrollRules | null | undefined)?.dayDivisor ?? null, hidden),
    ]);
    return {
      month,
      run: run && { id: run.id, status: run.status as PayrollStatus },
      locked: this.lockText(month, run?.status ?? null),
      people: [...people.values()],
      advances: advances.filter((a) => people.has(a.employee.id)),
      notOnRun,
      leftBehind,
      warnings,
    };
  }

  /**
   * The employees whose damage or loss deductions in `month` (pending and applied) pass 5 days' wage (Labour Law Art.
   * 151; owner, 18 October 2026: a warning only): the monthly gross of their signed contract in force in the month ÷ the
   * payroll's days in a month (the month's run's, `runDivisor`, else Payroll Setup's) × 5.
   */
  private async damageWarnings(month: string, runDivisor: number | null, hidden: readonly string[] = []): Promise<{ employeeId: string; text: string }[]> {
    const [first, last] = [toDateOnly(firstDay(month)), toDateOnly(lastDay(month))];
    const damage = await this.prisma.payrollAdjustment.groupBy({
      by: ['employeeId'],
      where: { month: first, kind: 'deduction', type: 'damage_loss', status: { in: ['pending', 'applied'] }, ...(hidden.length && { employeeId: { notIn: [...hidden] } }) },
      _sum: { amount: true },
    });
    if (!damage.length) return [];
    const [contracts, settings] = await Promise.all([
      this.prisma.contract.findMany({
        where: { status: { not: 'draft' }, startDate: { lte: last }, OR: [{ endDate: null }, { endDate: { gte: first } }], employment: { employeeId: { in: damage.map((d) => d.employeeId) } } },
        orderBy: { startDate: 'desc' },
        select: { grossSalary: true, employment: { select: { employeeId: true } } },
      }),
      runDivisor === null ? this.prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { dayDivisor: true } }) : null,
    ]);
    const divisor = runDivisor ?? settings?.dayDivisor ?? 30;
    // the latest contract of each in the month
    const gross = new Map<string, number>();
    for (const c of contracts) if (!gross.has(c.employment.employeeId)) gross.set(c.employment.employeeId, c.grossSalary.toNumber());
    return damage.flatMap((d) => {
      const text = damageLimitWarning(d._sum.amount?.toNumber() ?? 0, gross.get(d.employeeId) ?? 0, divisor);
      return text ? [{ employeeId: d.employeeId, text }] : [];
    });
  }

  /** The months approved (or paid) with pending additions or deductions left on them, oldest first, with how many. */
  async leftBehind(hidden: readonly string[] = []): Promise<{ month: string; count: number }[]> {
    const groups = await this.prisma.payrollAdjustment.groupBy({
      by: ['month'],
      where: { status: 'pending', ...(hidden.length && { employeeId: { notIn: [...hidden] } }) },
      _count: { _all: true },
    });
    if (!groups.length) return [];
    const runs = await this.prisma.payrollRun.findMany({ where: { month: { in: groups.map((g) => g.month) }, status: { in: ['approved', 'paid'] } }, select: { month: true } });
    const approved = new Set(runs.map((r) => fromDateOnly(r.month)));
    return groups
      .filter((g) => approved.has(fromDateOnly(g.month)))
      .map((g) => ({ month: fromDateOnly(g.month).slice(0, 7), count: g._count._all }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  async create(dto: CreateAdjustmentDto, user: SessionUser): Promise<AdjustmentView> {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true, employeeCode: true, fullNameEn: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    if (dto.kind === 'deduction' && dto.type === RECURRING_TYPE) throw new BadRequestException(RECURRING_BY_HAND);
    if (dto.kind === 'addition' && dto.type === LEAVE_PAYOUT_TYPE) throw new BadRequestException(LEAVE_PAYOUT_BY_HAND);
    if (!isAdjustmentType(dto.kind, dto.type)) throw new BadRequestException(this.typeMessage(dto.kind));
    const taxed = this.taxed(dto.kind, dto.type, dto.taxed);
    const { amount, days } = this.amountOrDays(dto.type, dto.amount ?? null, dto.days ?? null);
    this.assertMonthInRange(dto.month);
    await this.assertEmployed(employee, dto.month);
    await this.assertUnlocked(dto.month);
    const advanceId = await this.checkedAdvance({ employee, month: dto.month, kind: dto.kind, type: dto.type, amount: amount ?? 0, advanceId: dto.advanceId ?? null });
    if (advanceId) await assertInstallmentLimit(this.prisma, employee.id, [], [{ month: dto.month, amount: amount ?? 0 }], RECOVERY_INSTEAD);

    const row = await this.prisma.payrollAdjustment.create({
      data: {
        employeeId: employee.id,
        month: toDateOnly(firstDay(dto.month)),
        kind: dto.kind,
        type: dto.type,
        taxed,
        amount,
        days,
        reason: dto.reason,
        advanceId,
        createdById: user.id,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ADJUSTMENT,
      entityId: row.id,
      // the amount only as set (restricted, as a salary); the days as they are, like the run's days
      diff: {
        employeeCode: employee.employeeCode,
        month: dto.month,
        kind: dto.kind,
        type: dto.type,
        taxed,
        ...(days === null ? { amount: 'set' } : { days }),
        reason: dto.reason,
        ...(advanceId && { advanceId }),
      },
    });
    await this.runs.syncDrafts([dto.month], [employee.id], user);
    return this.get(row.id);
  }

  /**
   * Changes a pending one: its month (to another not locked), type (of the same kind), taxed (Other), amount or days (by
   * its type: a type in days takes days, the others an amount), reason, advance.
   */
  async update(id: string, dto: UpdateAdjustmentDto, user: SessionUser): Promise<AdjustmentView> {
    const row = await this.row(id);
    const kind = row.kind as AdjustmentKind;
    this.assertPending(row, 'changed');
    const was = this.monthOf(row);
    await this.assertUnlocked(was);

    const month = dto.month ?? was;
    const type = dto.type ?? row.type;
    if (type !== row.type && (row.type === RECURRING_TYPE || type === RECURRING_TYPE)) {
      throw new BadRequestException(row.type === RECURRING_TYPE ? "A recurring deduction's month stays a Recurring deduction: cancel it instead." : RECURRING_BY_HAND);
    }
    if (type !== row.type && (row.type === LEAVE_PAYOUT_TYPE || type === LEAVE_PAYOUT_TYPE)) {
      throw new BadRequestException(row.type === LEAVE_PAYOUT_TYPE ? 'Unused leave paid stays Unused leave paid: cancel it instead.' : LEAVE_PAYOUT_BY_HAND);
    }
    if (!isAdjustmentType(kind, type)) throw new BadRequestException(this.typeMessage(kind));
    // what the type takes: the one sent, else the one it has (an amount for an amount, days for days)
    const { amount, days } = this.amountOrDays(
      type,
      dto.amount ?? (isDaysType(type) ? null : (row.amount?.toNumber() ?? null)),
      dto.days ?? (isDaysType(type) ? (row.days?.toNumber() ?? null) : null),
      { amount: dto.amount !== undefined, days: dto.days !== undefined },
    );
    // Other keeps what HR chose unless it is sent again; the other types are taxed as their type says
    const taxed = this.taxed(kind, type, dto.taxed !== undefined && dto.taxed !== null ? dto.taxed : type === row.type ? row.taxed : null);
    if (month !== was) {
      this.assertMonthInRange(month);
      await this.assertEmployed(row.employee, month);
      await this.assertUnlocked(month);
      await this.assertRecurringFree([row], month);
    }
    // the advance stays unless another is sent, or the type no longer recovers one
    const wanted = dto.advanceId !== undefined ? dto.advanceId : recoveredKind(kind, type) ? row.advanceId : null;
    const advanceId = await this.checkedAdvance({ employee: row.employee, month, kind, type, amount: amount ?? 0, advanceId: wanted, excluding: row.id });
    // still a recovery: the month's installments with it as it would be
    if (advanceId) await assertInstallmentLimit(this.prisma, row.employeeId, [row.id], [{ month, amount: amount ?? 0 }], RECOVERY_INSTEAD);

    const before = {
      month: was,
      type: row.type,
      taxed: row.taxed,
      amount: row.amount?.toNumber() ?? null,
      days: row.days?.toNumber() ?? null,
      reason: row.reason,
      advanceId: row.advanceId,
    };
    const after = { month, type, taxed, amount, days, reason: dto.reason ?? row.reason, advanceId };
    const diff: Record<string, unknown> = changes(before, after);
    if (!Object.keys(diff).length) return this.get(id);
    if ('amount' in diff) diff.amount = 'changed';

    await this.prisma.payrollAdjustment.update({
      where: { id },
      data: { month: toDateOnly(firstDay(month)), type, taxed, amount, days, reason: after.reason, advanceId },
    });
    await this.audit.record({ userId: user.id, action: 'update', entityType: ADJUSTMENT, entityId: id, diff: { employeeCode: row.employee.employeeCode, kind, ...diff } });
    await this.runs.syncDrafts([was, month], [row.employeeId], user);
    return this.get(id);
  }

  /** Cancels a pending one while its month isn't locked: it stays on record, left out of every sum. */
  async cancel(id: string, user: SessionUser): Promise<AdjustmentView> {
    const row = await this.row(id);
    this.assertPending(row, 'cancelled');
    const month = this.monthOf(row);
    await this.assertUnlocked(month);
    await this.prisma.payrollAdjustment.update({ where: { id }, data: { status: 'cancelled', cancelledById: user.id, cancelledAt: new Date() } });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: ADJUSTMENT,
      entityId: id,
      diff: { employeeCode: row.employee.employeeCode, month, kind: row.kind, type: row.type, status: { from: 'pending', to: 'cancelled' } },
    });
    await this.runs.syncDrafts([month], [row.employeeId], user);
    return this.get(id);
  }

  /**
   * Moves pending ones to another month: from a month still open (as a change would), or, left on a month approved
   * without them, to a later month; never from a month whose run is with the CEO. The month moved to must take them
   * (in range, the person employed in it, its run not with the CEO, approved or paid). All or none; each move is in the
   * audit log.
   */
  async move(dto: MoveAdjustmentsDto, user: SessionUser): Promise<AdjustmentView[]> {
    const ids = [...new Set(dto.ids)];
    const rows = await this.prisma.payrollAdjustment.findMany({ where: { id: { in: ids } }, include: ADJUSTMENT_INCLUDE });
    if (rows.length !== ids.length) throw new NotFoundException('Some of these additions or deductions were not found. Reload the page and try again.');
    const to = dto.month;
    this.assertMonthInRange(to);
    await this.assertUnlocked(to);
    const statuses = new Map(
      (await this.prisma.payrollRun.findMany({ where: { month: { in: rows.map((r) => r.month) } }, select: { month: true, status: true } })).map((r) => [fromDateOnly(r.month), r.status]),
    );
    for (const row of rows) {
      this.assertPending(row, 'moved');
      const from = this.monthOf(row);
      const status = statuses.get(firstDay(from)) ?? null;
      if (status === 'pending_ceo') throw new ConflictException(this.lockText(from, status)!);
      if ((status === 'approved' || status === 'paid') && to <= from) {
        throw new BadRequestException(`The ${monthName(from)} payroll ${STATUS_TEXT[status as PayrollStatus]} without it: move it to a month after ${monthName(from)}.`);
      }
      if (to === from) throw new BadRequestException(`It is for ${monthName(from)} already: choose another month.`);
      await this.assertEmployed(row.employee, to);
      await this.checkedAdvance({
        employee: row.employee,
        month: to,
        kind: row.kind as AdjustmentKind,
        type: row.type,
        amount: row.amount?.toNumber() ?? 0,
        advanceId: row.advanceId,
        excluding: row.id,
      });
    }
    await this.assertRecurringFree(rows, to);
    // recoveries moved: each employee's installments in the month moved to
    const recoveries = rows.filter((r) => r.advanceId !== null && recoveredKind(r.kind, r.type) !== null);
    for (const employeeId of new Set(recoveries.map((r) => r.employeeId))) {
      const theirs = recoveries.filter((r) => r.employeeId === employeeId);
      await assertInstallmentLimit(
        this.prisma,
        employeeId,
        theirs.map((r) => r.id),
        theirs.map((r) => ({ month: to, amount: r.amount?.toNumber() ?? 0 })),
        'Move them to another month, or change their amounts.',
      );
    }
    await this.prisma.payrollAdjustment.updateMany({ where: { id: { in: ids } }, data: { month: toDateOnly(firstDay(to)) } });
    for (const row of rows) {
      await this.audit.record({
        userId: user.id,
        action: 'move',
        entityType: ADJUSTMENT,
        entityId: row.id,
        diff: { employeeCode: row.employee.employeeCode, kind: row.kind, type: row.type, month: { from: this.monthOf(row), to } },
      });
    }
    await this.runs.syncDrafts([...rows.map((r) => this.monthOf(r)), to], [...new Set(rows.map((r) => r.employeeId))], user);
    const moved = await this.prisma.payrollAdjustment.findMany({ where: { id: { in: ids } }, orderBy: [{ employee: { employeeCode: 'asc' } }, { createdAt: 'asc' }], include: ADJUSTMENT_INCLUDE });
    return this.views(moved);
  }

  // ---------- helpers ----------

  private async row(id: string): Promise<AdjustmentRow> {
    const row = await this.prisma.payrollAdjustment.findUnique({ where: { id }, include: ADJUSTMENT_INCLUDE });
    if (!row) throw new NotFoundException('Addition or deduction not found.');
    return row;
  }

  private async views(rows: readonly AdjustmentRow[]): Promise<AdjustmentView[]> {
    const [names, worked] = await Promise.all([userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.cancelledBy])), this.workedOut(rows)]);
    return rows.map((r) => adjustmentView(r, names, worked));
  }

  /**
   * What the months' runs worked the pending ones in days out to (owner, 17 October 2026: "N days ≈ EGP x" once
   * known), by id: as the lines of their people on those months' runs have them. None without a run, or off it.
   */
  private async workedOut(rows: readonly AdjustmentRow[]): Promise<Map<string, number>> {
    const inDays = rows.filter((r) => isDaysType(r.type) && r.status === 'pending' && r.amount === null);
    if (!inDays.length) return new Map();
    const lines = await this.prisma.payrollLine.findMany({
      where: { employeeId: { in: [...new Set(inDays.map((r) => r.employeeId))] }, run: { month: { in: [...new Set(inDays.map((r) => fromDateOnly(r.month)))].map(toDateOnly) } } },
      select: { result: true },
    });
    const worked = new Map<string, number>();
    for (const l of lines) for (const [id, amount] of paidAmounts(l.result)) worked.set(id, amount);
    return worked;
  }

  private monthOf = (row: { month: Date }) => fromDateOnly(row.month).slice(0, 7);

  /** The types HR enters by hand: every one of the kind but a Recurring deduction, which the month's run adds. */
  private typeMessage(kind: AdjustmentKind): string {
    const labels = ENTERED_TYPES[kind].map((t) => adjustmentTypeLabel(kind, t));
    return `Choose the type of ${ADJUSTMENT_KIND_LABELS[kind].toLowerCase()}: ${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}.`;
  }

  /** Whether it is taxed: as its type says, Other as HR chose. A choice sent for another type must agree with it. */
  private taxed(kind: AdjustmentKind, type: string, chosen: boolean | null | undefined): boolean {
    const taxed = adjustmentTaxed(kind, type, chosen);
    if (taxed === null) throw new BadRequestException('Say whether this other addition is taxed.');
    if (typeof chosen === 'boolean' && chosen !== taxed) {
      const what = typeWords(kind, type);
      throw new BadRequestException(kind === 'deduction' ? 'A deduction is taken after tax, so it is never taxed.' : `${what[0].toUpperCase()}${what.slice(1)} is ${taxed ? 'always' : 'never'} taxed.`);
    }
    return taxed;
  }

  /**
   * What a type takes (owner, 17 October 2026): one in days its days and no amount, which the run works out; every other
   * an amount and no days. `sent`: which of them were sent, changing one (an amount sent for a type in days is refused,
   * not dropped).
   */
  private amountOrDays(
    type: string,
    amount: number | null,
    days: number | null,
    sent: { amount: boolean; days: boolean } = { amount: amount !== null, days: days !== null },
  ): { amount: number | null; days: number | null } {
    if (isDaysType(type)) {
      if (sent.amount) throw new BadRequestException('A bonus or penalty in days is worked out by the payroll run: send the days, not an amount.');
      if (days === null) throw new BadRequestException('Enter the days, more than 0 and up to 31, in whole or half days, e.g. 2 or 1.5.');
      return { amount: null, days };
    }
    if (sent.days) throw new BadRequestException('Only a Bonus (days) or a Penalty (days) is entered in days: enter the amount in EGP.');
    if (amount === null) throw new BadRequestException('Enter the amount in EGP, more than 0, e.g. 1500 or 1500.50.');
    return { amount, days: null };
  }

  private assertMonthInRange(month: string) {
    const current = todayInCairo().slice(0, 7);
    const [earliest, latest] = [monthsLater(current, -ADJUSTMENT_MONTHS_BACK), monthsLater(current, ADJUSTMENT_MONTHS_AHEAD)];
    if (month < earliest || month > latest) throw new BadRequestException(`Choose a month from ${monthName(earliest)} to ${monthName(latest)}.`);
  }

  private async assertEmployed(employee: { id: string; fullNameEn: string }, month: string) {
    const employed = await this.prisma.employment.count({ where: { employeeId: employee.id, ...employedIn(month) } });
    if (!employed) throw new BadRequestException(`${employee.fullNameEn} isn't employed in ${monthName(month)}.`);
  }

  /** Why the month's additions and deductions can't be changed: its run is with the CEO, approved or paid. */
  private lockText(month: string, status: string | null): string | null {
    if (status === null || status === 'draft') return null;
    const later = status === 'pending_ceo' ? ' Ask the CEO to return the run, or enter it for a later month.' : ' Enter it for a later month.';
    return `The ${monthName(month)} payroll ${STATUS_TEXT[status as PayrollStatus]}, so its additions and deductions can't be changed.${later}`;
  }

  private async assertUnlocked(month: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { status: true } });
    const locked = this.lockText(month, run?.status ?? null);
    if (locked) throw new ConflictException(locked);
  }

  /**
   * A recurring deduction's month once (owner, 18 October 2026): a Recurring deduction moved to `month` only when its
   * recurring deduction has none there, and two of the same one never together.
   */
  private async assertRecurringFree(rows: readonly AdjustmentRow[], month: string) {
    const linked = rows.filter((r) => r.recurringId !== null);
    if (!linked.length) return;
    const ids = linked.map((r) => r.recurringId!);
    const taken = await this.prisma.payrollAdjustment.findFirst({
      where: { recurringId: { in: ids }, month: toDateOnly(firstDay(month)), id: { notIn: linked.map((r) => r.id) } },
      select: { reason: true },
    });
    const twice = linked.find((r, i) => ids.indexOf(r.recurringId!) !== i);
    if (taken || twice) throw new ConflictException(`${(taken ?? twice)!.reason} is deducted in ${monthName(month)} already: it is deducted once a month.`);
  }

  private assertPending(row: AdjustmentRow, doing: string) {
    if (row.status !== 'pending') {
      const what = row.kind === 'deduction' ? 'deduction' : 'addition';
      throw new ConflictException(`This ${what} is ${ADJUSTMENT_STATUS_LABELS[row.status as AdjustmentStatus]?.toLowerCase() ?? row.status}, so it can't be ${doing}.`);
    }
  }

  /**
   * The advance or loan an advance's recovery or a loan's installment recovers: the employee's own, of the kind, still
   * open, given by the month, with at least the amount left to recover once the other planned recoveries are taken.
   * None for any other type.
   */
  private async checkedAdvance(c: {
    employee: { id: string; fullNameEn: string };
    month: string;
    kind: AdjustmentKind;
    type: string;
    amount: number;
    advanceId: string | null;
    excluding?: string;
  }): Promise<string | null> {
    const needed = recoveredKind(c.kind, c.type);
    if (!needed) {
      if (c.advanceId) throw new BadRequestException("Only an advance's recovery or a loan's installment is linked to an advance or loan.");
      return null;
    }
    const word = ADVANCE_KIND_LABELS[needed].toLowerCase();
    if (!c.advanceId) throw new BadRequestException(`Choose the ${word} it recovers.`);
    const advance = await this.advances.row(c.advanceId).catch(() => null);
    if (!advance || advance.employeeId !== c.employee.id) throw new BadRequestException(`Choose one of ${c.employee.fullNameEn}'s ${word}s.`);
    if ((advance.kind as AdvanceKind) !== needed) {
      throw new BadRequestException(`${typeWords(c.kind, c.type).replace(/^a/, 'A')} recovers ${needed === 'loan' ? 'a loan' : 'an advance'}: choose one.`);
    }
    if (advance.status !== 'open') throw new ConflictException(`That ${word} is settled: nothing is left to recover.`);
    const given = fromDateOnly(advance.givenOn);
    if (c.month < given.slice(0, 7)) throw new BadRequestException(`That ${word} was given on ${shownDate(given)}: recover it from ${monthName(given.slice(0, 7))} on.`);
    const others = { ...advance, recoveries: advance.recoveries.filter((r) => r.id !== c.excluding) };
    const balance = balanceOf(others);
    const room = Math.max(0, sumAmounts([balance.outstanding, -balance.planned]));
    if (Math.round(c.amount * 100) > Math.round(room * 100)) {
      throw new BadRequestException(
        balance.planned > 0
          ? `Only ${egp(room)} is left to recover of that ${word}: ${egp(balance.outstanding)} is outstanding, ${egp(balance.planned)} of it planned already.`
          : `Only ${egp(room)} is left to recover of that ${word}.`,
      );
    }
    return advance.id;
  }
}
