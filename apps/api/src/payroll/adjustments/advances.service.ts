import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ADVANCE_KIND_LABELS,
  installmentPlan,
  installmentPlanProblems,
  installmentPlanText,
  isRecovered,
  RECOVERY_TYPE,
  type AdvanceKind,
  type Installment,
} from '@trendlix/shared';
import { AuditService, changes } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { firstDay, monthName, monthsLater } from '../months.js';
import type { AdvancesQueryDto, CreateAdvanceDto, UpdateAdvanceDto } from './adjustments.dto.js';
import { assertPlanWithinLimit } from './law-limits.js';
import { firstLocked, lockedMonths, payrollIs } from './locks.js';
import { egp, employedIn, userNames } from './people.js';
import { installmentReason } from './plans.js';
import { ADJUSTMENT, ADVANCE, ADVANCE_INCLUDE, advanceView, balanceOf, monthOfDate, type AdvanceRow, type AdvanceView } from './views.js';

/** "advance", "loan", as a message says it. */
export const kindWord = (kind: string) => (ADVANCE_KIND_LABELS[kind as AdvanceKind] ?? kind).toLowerCase();

/** How far ahead the first installment may be: as far as an addition or deduction can be entered, a year. */
const FIRST_INSTALLMENT_MONTHS_AHEAD = 12;

/** The fields that were sent (undefined means "leave as it is"). */
const sent = <T extends object>(dto: T) => Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;

// Advances and loans (owner, 17 October 2026: Unsettled lists "advances and loans (still being recovered)"): HR records
// one given to an employee (the amount, the day, why, and a plan in HR's words, e.g. "6 installments of 1,000"); it is
// recovered by deductions linked to it on Additions / Deductions (an advance's recovery, a loan's installment), those
// applied to a run counting as recovered and those pending as planned. It is settled automatically once nothing is
// outstanding (settleRecovered, when a run applies its recoveries), or by HR with a note, e.g. when it was paid back in
// cash (installments.service.ts). HR, Finance and the CEO see them; HR changes them. Every change is in the audit log,
// the amounts only as set or changed, as for a salary.
// Installments made at once (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription or
// something that needs to be deducted as installments on the employee. how will it be managed?"): recording one, HR may
// give how many months and the first month, and every monthly installment is made with it, equal amounts (the last
// taking the rounding), each a pending deduction linked to it, its plan the schedule's words. Moving, changing and
// settling them: installments.service.ts. Without them, it is recovered by deductions HR links by hand, as before.
@Injectable()
export class AdvancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every advance and loan, the open ones first, then the latest given first. */
  async list(query: AdvancesQueryDto): Promise<AdvanceView[]> {
    const rows = await this.prisma.payrollAdvance.findMany({
      where: { employeeId: query.employeeId, status: query.status },
      orderBy: [{ status: 'asc' }, { givenOn: 'desc' }, { createdAt: 'desc' }],
      include: ADVANCE_INCLUDE,
    });
    return this.views(rows);
  }

  async get(id: string): Promise<AdvanceView> {
    return (await this.views([await this.row(id)]))[0];
  }

  /**
   * HR records an advance or loan given, not in the future; with installments, every one of them at once, in one
   * transaction (18 October 2026). The caller works out again the draft runs of the installments' months.
   */
  async create(dto: CreateAdvanceDto, user: SessionUser): Promise<AdvanceView> {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true, employeeCode: true, fullNameEn: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    if (dto.givenOn > todayInCairo()) throw new BadRequestException(`The day the ${kindWord(dto.kind)} was given can't be in the future.`);
    const schedule = dto.installments ? await this.checkedPlan(employee, dto, dto.installments) : null;
    const plan = schedule ? installmentPlanText(schedule) : (dto.plan ?? null);
    const type = RECOVERY_TYPE[dto.kind];
    const { row, installments } = await this.prisma.$transaction(async (tx) => {
      const made = await tx.payrollAdvance.create({
        data: { employeeId: employee.id, kind: dto.kind, amount: dto.amount, givenOn: toDateOnly(dto.givenOn), reason: dto.reason, plan, createdById: user.id },
      });
      const recoveries = schedule
        ? await tx.payrollAdjustment.createManyAndReturn({
            data: schedule.map((p, i) => ({
              employeeId: employee.id,
              month: toDateOnly(firstDay(p.month)),
              kind: 'deduction',
              type,
              taxed: false,
              amount: p.amount,
              reason: installmentReason(dto.kind, i + 1, schedule.length),
              advanceId: made.id,
              createdById: user.id,
            })),
            select: { id: true, month: true, reason: true },
          })
        : [];
      return { row: made, installments: recoveries };
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ADVANCE,
      entityId: row.id,
      // the amount only as set (restricted, as a salary)
      diff: {
        employeeCode: employee.employeeCode,
        kind: dto.kind,
        amount: 'set',
        givenOn: dto.givenOn,
        reason: dto.reason,
        plan,
        ...(dto.installments && { installments: { count: dto.installments.count, firstMonth: dto.installments.firstMonth } }),
      },
    });
    for (const i of [...installments].sort((a, b) => a.month.getTime() - b.month.getTime())) {
      await this.audit.record({
        userId: user.id,
        action: 'create',
        entityType: ADJUSTMENT,
        entityId: i.id,
        diff: { employeeCode: employee.employeeCode, month: monthOfDate(i.month), kind: 'deduction', type, taxed: false, amount: 'set', reason: i.reason, advanceId: row.id },
      });
    }
    return this.get(row.id);
  }

  /**
   * The installments of one being recorded (18 October 2026): the plan's problems none, the first month from the month
   * it was given and at most a year ahead, the employee employed then, none of the plan's months a month whose run is
   * with the CEO, approved or paid (it would never take it), and none taking the employee's installments over the
   * law's limit (owner, 18 October 2026, after reading the law: "Block above 10%"; law-limits.ts).
   */
  private async checkedPlan(
    employee: { id: string; fullNameEn: string },
    dto: CreateAdvanceDto,
    wanted: { count: number; firstMonth: string },
  ): Promise<Installment[]> {
    const problems = installmentPlanProblems(dto.amount, wanted.count, wanted.firstMonth);
    if (problems.length) throw new BadRequestException(problems.length === 1 ? problems[0] : problems);
    const given = dto.givenOn.slice(0, 7);
    if (wanted.firstMonth < given) {
      throw new BadRequestException(`The ${kindWord(dto.kind)} was given on ${shownDate(dto.givenOn)}: start the installments from ${monthName(given)} on.`);
    }
    const latest = monthsLater(todayInCairo().slice(0, 7), FIRST_INSTALLMENT_MONTHS_AHEAD);
    if (wanted.firstMonth > latest) throw new BadRequestException(`Start the installments by ${monthName(latest)}.`);
    const employed = await this.prisma.employment.count({ where: { employeeId: employee.id, ...employedIn(wanted.firstMonth) } });
    if (!employed) throw new BadRequestException(`${employee.fullNameEn} isn't employed in ${monthName(wanted.firstMonth)}: start the installments from a month they are.`);
    const schedule = installmentPlan(dto.amount, wanted.count, wanted.firstMonth);
    const locked = firstLocked(await lockedMonths(this.prisma, schedule.map((p) => p.month)));
    if (locked) throw new BadRequestException(`${payrollIs(locked.month, locked.status)}, so it can't take an installment: start the installments from a later month.`);
    await assertPlanWithinLimit(this.prisma, employee.id, schedule);
    return schedule;
  }

  /** HR changes an open one: the amount never below what is recovered and planned, the day not in the future. */
  async update(id: string, dto: UpdateAdvanceDto, user: SessionUser): Promise<AdvanceView> {
    const row = await this.row(id);
    this.assertOpen(row, 'changed');
    const change = sent(dto);
    const balance = balanceOf(row);
    const taken = Math.round((balance.recovered + balance.planned) * 100) / 100;
    if (change.amount !== undefined && change.amount < taken) {
      throw new BadRequestException(`The amount can't be less than what is recovered and planned already: ${egp(taken)}.`);
    }
    if (change.givenOn !== undefined && change.givenOn > todayInCairo()) {
      throw new BadRequestException(`The day the ${kindWord(row.kind)} was given can't be in the future.`);
    }
    if (change.givenOn !== undefined) {
      const early = row.recoveries.find((r) => r.status !== 'cancelled' && fromDateOnly(r.month).slice(0, 7) < change.givenOn!.slice(0, 7));
      if (early) throw new BadRequestException(`A recovery is planned for ${monthName(fromDateOnly(early.month).slice(0, 7))}, before that month: change it first.`);
    }
    const before = { amount: row.amount.toNumber(), givenOn: fromDateOnly(row.givenOn), reason: row.reason, plan: row.plan };
    const diff: Record<string, unknown> = changes(before, change);
    if (!Object.keys(diff).length) return this.get(id);
    if ('amount' in diff) diff.amount = 'changed';
    await this.prisma.payrollAdvance.update({
      where: { id },
      data: { amount: change.amount, givenOn: change.givenOn === undefined ? undefined : toDateOnly(change.givenOn), reason: change.reason, plan: change.plan },
    });
    await this.audit.record({ userId: user.id, action: 'update', entityType: ADVANCE, entityId: id, diff: { employeeCode: row.employee.employeeCode, ...diff } });
    // a smaller amount may be recovered already
    await this.settleRecovered([id]);
    return this.get(id);
  }

  /**
   * Settles automatically each open one of these with nothing outstanding (no user, no note): called when recoveries are
   * applied to a run (the CEO approves it) or an amount is lowered to what was recovered. Answers the ids settled.
   */
  async settleRecovered(ids: readonly string[], tx: Prisma.TransactionClient = this.prisma): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await tx.payrollAdvance.findMany({ where: { id: { in: [...ids] }, status: 'open' }, include: ADVANCE_INCLUDE });
    const done = rows.filter((r) => isRecovered(balanceOf(r)));
    for (const r of done) {
      await tx.payrollAdvance.update({ where: { id: r.id }, data: { status: 'settled', settledAt: new Date(), settledById: null, settledNote: null, settledHow: 'recovered' } });
      await this.audit.record({
        userId: null,
        action: 'settle',
        entityType: ADVANCE,
        entityId: r.id,
        diff: { employeeCode: r.employee.employeeCode, status: { from: 'open', to: 'settled' }, how: 'recovered', automatically: true },
      });
    }
    return done.map((r) => r.id);
  }

  // ---------- helpers ----------

  async row(id: string): Promise<AdvanceRow> {
    const row = await this.prisma.payrollAdvance.findUnique({ where: { id }, include: ADVANCE_INCLUDE });
    if (!row) throw new NotFoundException('Advance or loan not found.');
    return row;
  }

  async views(rows: readonly AdvanceRow[]): Promise<AdvanceView[]> {
    const [names, locked] = await Promise.all([
      userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.settledBy])),
      // the months of their installments HR can no longer move or change
      lockedMonths(this.prisma, rows.flatMap((r) => r.recoveries.filter((x) => x.status === 'pending').map((x) => monthOfDate(x.month)))),
    ]);
    const months = new Set(locked.keys());
    return rows.map((r) => advanceView(r, names, months));
  }

  assertOpen(row: AdvanceRow, doing: string) {
    if (row.status !== 'open') throw new ConflictException(`This ${kindWord(row.kind)} is settled, so it can't be ${doing}.`);
  }
}
