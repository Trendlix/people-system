import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ADVANCE_KIND_LABELS, isRecovered, type AdvanceKind } from '@trendlix/shared';
import { AuditService, changes } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { monthName } from '../months.js';
import type { AdvancesQueryDto, CreateAdvanceDto, SettleAdvanceDto, UpdateAdvanceDto } from './adjustments.dto.js';
import { egp, userNames } from './people.js';
import { ADVANCE, ADVANCE_INCLUDE, advanceView, balanceOf, type AdvanceRow, type AdvanceView } from './views.js';

/** "advance", "loan", as a message says it. */
const kindWord = (kind: string) => (ADVANCE_KIND_LABELS[kind as AdvanceKind] ?? kind).toLowerCase();

/** The fields that were sent (undefined means "leave as it is"). */
const sent = <T extends object>(dto: T) => Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;

// Advances and loans (owner, 17 October 2026: Unsettled lists "advances and loans (still being recovered)"): HR records
// one given to an employee (the amount, the day, why, and a plan in HR's words, e.g. "6 installments of 1,000"); it is
// recovered by deductions linked to it on Additions / Deductions (an advance's recovery, a loan's installment), those
// applied to a run counting as recovered and those pending as planned. It is settled automatically once nothing is
// outstanding (settleRecovered, when a run applies its recoveries), or by HR with a note, e.g. when it was paid back in
// cash. HR, Finance and the CEO see them; HR changes them. Every change is in the audit log, the amounts only as set
// or changed, as for a salary.
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

  /** HR records an advance or loan given, not in the future. */
  async create(dto: CreateAdvanceDto, user: SessionUser): Promise<AdvanceView> {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true, employeeCode: true, fullNameEn: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    if (dto.givenOn > todayInCairo()) throw new BadRequestException(`The day the ${kindWord(dto.kind)} was given can't be in the future.`);
    const row = await this.prisma.payrollAdvance.create({
      data: {
        employeeId: employee.id,
        kind: dto.kind,
        amount: dto.amount,
        givenOn: toDateOnly(dto.givenOn),
        reason: dto.reason,
        plan: dto.plan ?? null,
        createdById: user.id,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ADVANCE,
      entityId: row.id,
      // the amount only as set (restricted, as a salary)
      diff: { employeeCode: employee.employeeCode, kind: dto.kind, amount: 'set', givenOn: dto.givenOn, reason: dto.reason, plan: dto.plan ?? null },
    });
    return this.get(row.id);
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
   * HR marks an open one settled, saying how (e.g. paid back in cash): with no recovery still planned, as those would
   * still be taken from the pay.
   */
  async settle(id: string, dto: SettleAdvanceDto, user: SessionUser): Promise<AdvanceView> {
    const row = await this.row(id);
    this.assertOpen(row, 'settled');
    const planned = row.recoveries.filter((r) => r.status === 'pending').length;
    if (planned) {
      throw new ConflictException(
        `${planned === 1 ? 'A recovery is' : `${planned} recoveries are`} still planned for this ${kindWord(row.kind)} on Additions / Deductions: cancel ${planned === 1 ? 'it' : 'them'} first, or let ${planned === 1 ? 'it' : 'them'} be taken.`,
      );
    }
    const balance = balanceOf(row);
    await this.prisma.payrollAdvance.update({ where: { id }, data: { status: 'settled', settledAt: new Date(), settledById: user.id, settledNote: dto.note } });
    await this.audit.record({
      userId: user.id,
      action: 'settle',
      entityType: ADVANCE,
      entityId: id,
      diff: { employeeCode: row.employee.employeeCode, status: { from: 'open', to: 'settled' }, note: dto.note, outstanding: balance.outstanding > 0 ? 'some' : 'none' },
    });
    return this.get(id);
  }

  /**
   * Settles automatically each open one of these with nothing outstanding (no user, no note): called when recoveries are
   * applied to a run (phase 2) or an amount is lowered to what was recovered. Answers the ids settled.
   */
  async settleRecovered(ids: readonly string[], tx: Prisma.TransactionClient = this.prisma): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await tx.payrollAdvance.findMany({ where: { id: { in: [...ids] }, status: 'open' }, include: ADVANCE_INCLUDE });
    const done = rows.filter((r) => isRecovered(balanceOf(r)));
    for (const r of done) {
      await tx.payrollAdvance.update({ where: { id: r.id }, data: { status: 'settled', settledAt: new Date(), settledById: null, settledNote: null } });
      await this.audit.record({
        userId: null,
        action: 'settle',
        entityType: ADVANCE,
        entityId: r.id,
        diff: { employeeCode: r.employee.employeeCode, status: { from: 'open', to: 'settled' }, automatically: true },
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
    const names = await userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.settledBy]));
    return rows.map((r) => advanceView(r, names));
  }

  private assertOpen(row: AdvanceRow, doing: string) {
    if (row.status !== 'open') throw new ConflictException(`This ${kindWord(row.kind)} is settled, so it can't be ${doing}.`);
  }
}
