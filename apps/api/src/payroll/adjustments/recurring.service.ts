import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { monthPlus, RECURRING_TYPE, recurringDeductionProblems, recurringDue } from '@trendlix/shared';
import { AuditService, changes } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { todayInCairo, toDateOnly } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PaperworkService } from '../../paperwork/paperwork.service.js';
import { ConfidentialService } from '../../employees/confidential.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { firstDay, monthName } from '../months.js';
import {
  MORE_CONSENT_MESSAGE,
  type ChangeRecurringDeductionDto,
  type CreateRecurringDeductionDto,
  type RecurringDeductionsQueryDto,
  type StopRecurringDeductionDto,
  type UpdateRecurringDeductionDto,
} from './adjustments.dto.js';
import { firstLocked, lockedMonths, payrollIs } from './locks.js';
import { egp, employedIn, userNames } from './people.js';
import { laterMonth, lastMonthOf } from './plans.js';
import { RunAdjustmentsService } from './run-adjustments.service.js';
import { ADJUSTMENT, monthOfDate, RECURRING, RECURRING_INCLUDE, recurringMonths, recurringView, type RecurringDeductionView, type RecurringRow } from './views.js';

/** The note a recurring deduction is stopped with when its employment ends. */
export const LEFT_NOTE = 'Left the company';

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

// Recurring deductions (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription or
// something that needs to be deducted as installments on the employee. how will it be managed?"; asked, the owner chose
// an ongoing monthly share for a medical subscription): HR sets one up for an employee (what for, the amount a month,
// the first month and, if it ends, the last), and each month's run, when it is made or refreshed, adds the month's
// Recurring deduction (after tax, like every deduction, its reason the name, so the payslip says "Medical subscription
// (family)") for each one due that month whose employee is employed in it, once a month whatever became of it: a month
// HR cancelled on Additions / Deductions isn't added again. HR changes the amount from a month on (this one stopped
// then, a new one from then, with the same name and last month), stops it from a month on, or renames it or changes
// its last month; the months' Recurring deductions still pending from then on are cancelled, never one in a month whose
// run is with the CEO, approved or paid. When an employment ends, its recurring deductions stop from the month after the
// last working day (owner's words on leaving: what is left is "taken from the final settlement, unless waived"; a
// monthly share simply stops). HR, Finance and the CEO see them, HR changes them; the employee sees their own on their
// profile (deduction plans). Every change is in the audit log, the amounts only as set or changed, as for a salary.
// The employee's written consent (Labour Law 14/2025 Art. 114: "ويشترط لصحة النزول عن الأجر ... أن تصدر به موافقة
// مكتوبة من العامل"; owner, 18 October 2026, after reading the law: "Warn above 25%, record the consent"): HR ticks
// that it is on file to set one up, kept with who and when, and may attach the signed consent, kept in the employee
// file as a paper (deduction_consent) like the other papers; one set up before has none until HR records it
// (recordConsent). A higher amount needs it again; a lower one keeps it. The 25% is a warning only: the forms show it
// as they are typed, and the run's line (payroll views.ts).
@Injectable()
export class RecurringDeductionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly runs: RunAdjustmentsService,
    private readonly paperwork: PaperworkService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** Every one asked for, by employee name, then the earliest first; `running` lists those still to come too. */
  async list(query: RecurringDeductionsQueryDto, hidden: readonly string[] = []): Promise<RecurringDeductionView[]> {
    const rows = await this.prisma.recurringDeduction.findMany({
      // not the C-level people's (`hidden`) for anyone but the CEO and a Super Admin (owner, 19 October 2026)
      where: { AND: [{ employeeId: query.employeeId }, hidden.length ? { employeeId: { notIn: [...hidden] } } : {}] },
      orderBy: [{ employee: { fullNameEn: 'asc' } }, { startMonth: 'asc' }, { createdAt: 'asc' }],
      include: RECURRING_INCLUDE,
    });
    const views = await this.views(rows);
    if (!query.status) return views;
    if (query.status === 'running') return views.filter((v) => v.status !== 'ended');
    return views.filter((v) => v.status === query.status);
  }

  async get(id: string): Promise<RecurringDeductionView> {
    return (await this.views([await this.row(id)]))[0];
  }

  /** The employee's that are running or still to come, the earliest first: their profile's deduction plans. */
  async forEmployee(employeeId: string): Promise<RecurringDeductionView[]> {
    return this.list({ employeeId, status: 'running' });
  }

  /**
   * HR sets one up: the rules' problems none, the employee with an employment from the first month on, the first month
   * not one whose run is with the CEO, approved or paid (it would never take it), and the employee's signed consent on
   * file (the DTO's consentOnFile), recorded with who and when. The signed consent, if attached (`file`), goes to the
   * employee file once all else is checked, and is linked to it. A draft run of one of its months takes it at once.
   */
  async create(dto: CreateRecurringDeductionDto, file: Express.Multer.File | undefined, user: SessionUser): Promise<RecurringDeductionView> {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true, employeeCode: true, fullNameEn: true } });
    // a form with a file is read after the guards: a C-level person hidden from the caller is checked here (owner, 19
    // October 2026)
    if (!employee || (await this.confidential.isHidden(user, employee.id))) throw new NotFoundException('Employee not found.');
    const endMonth = dto.endMonth ?? null;
    this.assertNoProblems(dto.amount, dto.startMonth, endMonth);
    const employed = await this.prisma.employment.count({
      where: { employeeId: employee.id, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(firstDay(dto.startMonth)) } }] },
    });
    if (!employed) throw new BadRequestException(`${employee.fullNameEn} has no employment from ${monthName(dto.startMonth)} on.`);
    await this.assertOpenMonth(dto.startMonth, 'start it from a later month');
    // the signed consent to the employee file, the last check (a file that isn't a photo or a PDF is refused)
    const paper = file ? await this.paperwork.upload(employee.id, { kind: 'deduction_consent' }, file, user) : null;
    const row = await this.prisma.recurringDeduction.create({
      data: {
        employeeId: employee.id,
        name: dto.name,
        amount: dto.amount,
        startMonth: toDateOnly(firstDay(dto.startMonth)),
        endMonth: endMonth && toDateOnly(firstDay(endMonth)),
        createdById: user.id,
        consentRecordedAt: new Date(),
        consentRecordedById: user.id,
        consentPaperworkId: paper?.id ?? null,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: RECURRING,
      entityId: row.id,
      // the amount only as set (restricted, as a salary)
      diff: {
        employeeCode: employee.employeeCode,
        name: dto.name,
        amount: 'set',
        startMonth: dto.startMonth,
        endMonth,
        consent: 'recorded',
        ...(paper && { consentFile: paper.fileName, consentPaperworkId: paper.id }),
      },
    });
    await this.addToDrafts(row.id, dto.startMonth, user);
    return this.get(row.id);
  }

  /**
   * HR changes the amount from a month on: this one is stopped then and a new one, with the same name and last month
   * (and the stop HR set for a later month, if any), starts then. The month from its first on, one it is deducted in,
   * and not one whose run is with the CEO, approved or paid. A higher amount needs the employee's signed consent to it
   * on file (the DTO's consentOnFile, recorded anew); a lower one keeps the consent this one has (or records it, when
   * ticked and none was). Answers the new one.
   */
  async change(id: string, dto: ChangeRecurringDeductionDto, user: SessionUser): Promise<RecurringDeductionView> {
    const row = await this.row(id);
    const months = recurringMonths(row);
    const from = dto.fromMonth;
    if (from < months.startMonth) throw new BadRequestException(`It starts in ${monthName(months.startMonth)}: change it from then on.`);
    if (!recurringDue(months, from)) throw new ConflictException(this.notDeductedText(row, from));
    if (Math.round(dto.amount * 100) === Math.round(row.amount.toNumber() * 100)) throw new BadRequestException(`It is ${egp(dto.amount)} a month already.`);
    this.assertNoProblems(dto.amount, from, months.endMonth);
    const raised = Math.round(dto.amount * 100) > Math.round(row.amount.toNumber() * 100);
    if (raised && dto.consentOnFile !== true) throw new BadRequestException(MORE_CONSENT_MESSAGE);
    await this.assertOpenMonth(from, 'change it from a later month');
    const cancelled = await this.pendingFrom(row, from);
    // the consent the new one has: recorded anew for more, or when ticked and none was; else this one's
    const anew = raised || (dto.consentOnFile === true && row.consentRecordedAt === null);
    const consent = anew
      ? { consentRecordedAt: new Date(), consentRecordedById: user.id, consentPaperworkId: null }
      : { consentRecordedAt: row.consentRecordedAt, consentRecordedById: row.consentRecordedById, consentPaperworkId: row.consentPaperworkId };

    const made = await this.prisma.$transaction(async (tx) => {
      await tx.recurringDeduction.update({ where: { id }, data: { stoppedFrom: toDateOnly(firstDay(from)), stopNote: `Amount changed from ${monthName(from)}` } });
      await this.cancel(tx, cancelled, user);
      return tx.recurringDeduction.create({
        data: {
          employeeId: row.employeeId,
          name: row.name,
          amount: dto.amount,
          startMonth: toDateOnly(firstDay(from)),
          endMonth: row.endMonth,
          // stopped from a later month already: the new one stops then too
          stoppedFrom: row.stoppedFrom,
          stopNote: row.stoppedFrom ? row.stopNote : null,
          createdById: user.id,
          ...consent,
        },
      });
    });
    await this.audit.record({
      userId: user.id,
      action: 'change',
      entityType: RECURRING,
      entityId: id,
      diff: { employeeCode: row.employee.employeeCode, name: row.name, amount: 'changed', stoppedFrom: from, replacedBy: made.id },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: RECURRING,
      entityId: made.id,
      diff: {
        employeeCode: row.employee.employeeCode,
        name: row.name,
        amount: 'set',
        startMonth: from,
        endMonth: months.endMonth,
        ...(months.stoppedFrom && { stoppedFrom: months.stoppedFrom }),
        replaces: id,
        consent: anew ? 'recorded' : consent.consentRecordedAt ? 'as before' : 'not recorded',
      },
    });
    await this.recordCancelled(row, cancelled, user);
    await this.runs.syncDrafts(cancelled.map((c) => c.month), [row.employeeId], user);
    await this.addToDrafts(made.id, from, user);
    return this.get(made.id);
  }

  /** HR stops one from a month on (the first month no longer deducted): not one whose run is with the CEO, approved or paid. */
  async stop(id: string, dto: StopRecurringDeductionDto, user: SessionUser): Promise<RecurringDeductionView> {
    const row = await this.row(id);
    const months = recurringMonths(row);
    // stopped before it begins: it never is deducted
    const from = laterMonth(dto.fromMonth, months.startMonth);
    if (months.stoppedFrom !== null && months.stoppedFrom <= from) throw new ConflictException(`It is stopped from ${monthName(months.stoppedFrom)} already.`);
    if (months.endMonth !== null && months.endMonth < from) {
      throw new ConflictException(`Its last month is ${monthName(months.endMonth)}: nothing is deducted from ${monthName(from)} on.`);
    }
    await this.assertOpenMonth(from, 'stop it from a later month');
    const cancelled = await this.pendingFrom(row, from);
    const note = dto.note ?? null;
    await this.prisma.$transaction(async (tx) => {
      await tx.recurringDeduction.update({ where: { id }, data: { stoppedFrom: toDateOnly(firstDay(from)), stopNote: note } });
      await this.cancel(tx, cancelled, user);
    });
    await this.audit.record({
      userId: user.id,
      action: 'stop',
      entityType: RECURRING,
      entityId: id,
      diff: { employeeCode: row.employee.employeeCode, name: row.name, stoppedFrom: { from: months.stoppedFrom, to: from }, note },
    });
    await this.recordCancelled(row, cancelled, user);
    await this.runs.syncDrafts(cancelled.map((c) => c.month), [row.employeeId], user);
    return this.get(id);
  }

  /**
   * HR renames one (its months' Recurring deductions still pending say the new name) or changes its last month: never
   * before a month it was deducted in, the pending ones after it cancelled, a later one added to a draft run of its
   * months.
   */
  async update(id: string, dto: UpdateRecurringDeductionDto, user: SessionUser): Promise<RecurringDeductionView> {
    const row = await this.row(id);
    const months = recurringMonths(row);
    const endMonth = dto.endMonth === undefined ? months.endMonth : dto.endMonth;
    const diff: Record<string, unknown> = changes({ name: row.name, endMonth: months.endMonth }, { name: dto.name, endMonth: dto.endMonth });
    if (!Object.keys(diff).length) return this.get(id);
    if ('endMonth' in diff) {
      this.assertNoProblems(row.amount.toNumber(), months.startMonth, endMonth);
      const applied = row.deductions.filter((d) => d.status === 'applied').map((d) => monthOfDate(d.month)).sort().at(-1);
      if (endMonth !== null && applied && applied > endMonth) {
        throw new BadRequestException(`It was deducted in ${monthName(applied)} already: its last month can't be before that.`);
      }
    }
    const cancelled = 'endMonth' in diff && endMonth !== null ? await this.pendingFrom(row, monthPlus(endMonth, 1)) : [];
    // the name on its pending months, those not with the CEO, approved or paid
    const renamed = dto.name !== undefined && dto.name !== row.name ? await this.pendingFrom(row, months.startMonth, false) : [];
    const cancelledIds = new Set(cancelled.map((c) => c.id));
    await this.prisma.$transaction(async (tx) => {
      await tx.recurringDeduction.update({ where: { id }, data: { name: dto.name, endMonth: endMonth && toDateOnly(firstDay(endMonth)) } });
      await this.cancel(tx, cancelled, user);
      const rename = renamed.filter((r) => !cancelledIds.has(r.id)).map((r) => r.id);
      if (rename.length) await tx.payrollAdjustment.updateMany({ where: { id: { in: rename } }, data: { reason: dto.name } });
    });
    await this.audit.record({ userId: user.id, action: 'update', entityType: RECURRING, entityId: id, diff: { employeeCode: row.employee.employeeCode, ...diff } });
    await this.recordCancelled(row, cancelled, user);
    for (const r of renamed.filter((x) => !cancelledIds.has(x.id))) {
      await this.audit.record({
        userId: user.id,
        action: 'update',
        entityType: ADJUSTMENT,
        entityId: r.id,
        diff: { employeeCode: row.employee.employeeCode, kind: 'deduction', reason: { from: row.name, to: dto.name }, recurringId: id },
      });
    }
    await this.runs.syncDrafts([...cancelled, ...renamed].map((c) => c.month), [row.employeeId], user);
    if ('endMonth' in diff) await this.addToDrafts(id, months.startMonth, user);
    return this.get(id);
  }

  /**
   * HR records that the employee's signed consent is on file (Labour Law Art. 114; owner, 18 October 2026, after
   * reading the law: "record the consent"), for one set up before it was asked, with who and when; and attaches the
   * signed consent (`file`, optional), kept in the employee file and linked to it, also to one whose consent is
   * recorded already (the one attached before stays in the employee file). Refused when it is recorded and no file is
   * sent: there is nothing to record.
   */
  async recordConsent(id: string, file: Express.Multer.File | undefined, user: SessionUser): Promise<RecurringDeductionView> {
    const row = await this.row(id);
    if (row.consentRecordedAt && !file) throw new ConflictException('Its consent is recorded already. Attach the signed consent to keep it with it.');
    const paper = file ? await this.paperwork.upload(row.employeeId, { kind: 'deduction_consent' }, file, user) : null;
    const recording = row.consentRecordedAt === null;
    await this.prisma.recurringDeduction.update({
      where: { id },
      data: {
        ...(recording && { consentRecordedAt: new Date(), consentRecordedById: user.id }),
        ...(paper && { consentPaperworkId: paper.id }),
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'record_consent',
      entityType: RECURRING,
      entityId: id,
      diff: {
        employeeCode: row.employee.employeeCode,
        name: row.name,
        consent: recording ? { from: 'not recorded', to: 'recorded' } : 'as before',
        ...(paper && { consentFile: paper.fileName, consentPaperworkId: { from: row.consentPaperworkId, to: paper.id } }),
      },
    });
    return this.get(id);
  }

  // ---------- each month's run, and leaving ----------

  /**
   * Adds the month's Recurring deduction of every recurring deduction due in `month` whose employee is employed in it,
   * once a month (one there already, whatever became of it, is left as it is): when the month's run is made or
   * refreshed (payroll.service.ts), before it takes the month's pending additions and deductions. Each one added is in
   * the audit log. Answers how many were added.
   */
  async addToMonth(month: string, user: SessionUser | null, only?: { recurringId: string }): Promise<number> {
    const first = toDateOnly(firstDay(month));
    const rows = await this.prisma.recurringDeduction.findMany({
      where: {
        ...(only && { id: only.recurringId }),
        startMonth: { lte: first },
        AND: [{ OR: [{ endMonth: null }, { endMonth: { gte: first } }] }, { OR: [{ stoppedFrom: null }, { stoppedFrom: { gt: first } }] }],
        deductions: { none: { month: first } },
      },
      select: { id: true, employeeId: true, name: true, amount: true, startMonth: true, endMonth: true, stoppedFrom: true, employee: { select: { employeeCode: true } } },
    });
    const due = rows.filter((r) => recurringDue(recurringMonths(r), month));
    if (!due.length) return 0;
    const employed = new Set(
      (
        await this.prisma.employment.findMany({ where: { employeeId: { in: [...new Set(due.map((r) => r.employeeId))] }, ...employedIn(month) }, select: { employeeId: true } })
      ).map((e) => e.employeeId),
    );
    const adding = due.filter((r) => employed.has(r.employeeId));
    if (!adding.length) return 0;
    // never twice for a month, even when two runs are refreshed at once
    const made = await this.prisma.payrollAdjustment.createManyAndReturn({
      data: adding.map((r) => ({
        employeeId: r.employeeId,
        month: first,
        kind: 'deduction',
        type: RECURRING_TYPE,
        taxed: false,
        amount: r.amount,
        reason: r.name,
        recurringId: r.id,
        createdById: user?.id ?? null,
      })),
      skipDuplicates: true,
      select: { id: true, recurringId: true },
    });
    const byId = new Map(adding.map((r) => [r.id, r]));
    for (const m of made) {
      const r = byId.get(m.recurringId!)!;
      await this.audit.record({
        userId: user?.id ?? null,
        action: 'create',
        entityType: ADJUSTMENT,
        entityId: m.id,
        // the amount only as set (restricted, as a salary)
        diff: { employeeCode: r.employee.employeeCode, month, kind: 'deduction', type: RECURRING_TYPE, taxed: false, amount: 'set', reason: r.name, recurringId: r.id, automatically: true },
      });
    }
    return made.length;
  }

  /**
   * An employment ended on `lastWorkingDay` (EmploymentsService.close: by hand, or HR completing an approved ending): the
   * employee's recurring deductions still deducted after it stop from the month after ("Left the company"), and their
   * months' Recurring deductions still pending from then on are cancelled. In the caller's transaction, `db`.
   */
  async stopForLeaving(employeeId: string, lastWorkingDay: string, user: SessionUser, db: Db = this.prisma): Promise<void> {
    const from = monthPlus(lastWorkingDay.slice(0, 7), 1);
    const first = toDateOnly(firstDay(from));
    const rows = await db.recurringDeduction.findMany({
      where: {
        employeeId,
        AND: [{ OR: [{ endMonth: null }, { endMonth: { gte: first } }] }, { OR: [{ stoppedFrom: null }, { stoppedFrom: { gt: first } }] }],
      },
      include: RECURRING_INCLUDE,
    });
    for (const row of rows) {
      const months = recurringMonths(row);
      // one still to come never starts
      const stoppedFrom = laterMonth(from, months.startMonth);
      if (months.stoppedFrom !== null && months.stoppedFrom <= stoppedFrom) continue;
      const cancelled = row.deductions.filter((d) => d.status === 'pending' && monthOfDate(d.month) >= stoppedFrom).map((d) => ({ id: d.id, month: monthOfDate(d.month) }));
      await db.recurringDeduction.update({ where: { id: row.id }, data: { stoppedFrom: toDateOnly(firstDay(stoppedFrom)), stopNote: LEFT_NOTE } });
      await this.cancel(db, cancelled, user);
      await this.audit.record({
        userId: user.id,
        action: 'stop',
        entityType: RECURRING,
        entityId: row.id,
        diff: { employeeCode: row.employee.employeeCode, name: row.name, stoppedFrom: { from: months.stoppedFrom, to: stoppedFrom }, note: LEFT_NOTE, automatically: true },
      });
      await this.recordCancelled(row, cancelled, user);
    }
  }

  // ---------- helpers ----------

  /** As the API sends them, with the names of who recorded the consents. */
  private async views(rows: readonly RecurringRow[]): Promise<RecurringDeductionView[]> {
    const names = await userNames(this.prisma, rows.map((r) => r.consentRecordedBy));
    const current = todayInCairo().slice(0, 7);
    return rows.map((r) => recurringView(r, current, names));
  }

  private async row(id: string): Promise<RecurringRow> {
    const row = await this.prisma.recurringDeduction.findUnique({ where: { id }, include: RECURRING_INCLUDE });
    if (!row) throw new NotFoundException('Recurring deduction not found.');
    return row;
  }

  private assertNoProblems(amount: number, startMonth: string, endMonth: string | null) {
    const problems = recurringDeductionProblems(amount, startMonth, endMonth);
    if (problems.length) throw new BadRequestException(problems.length === 1 ? problems[0] : problems);
  }

  /** A month whose deductions may still change: its run not with the CEO, approved or paid. */
  private async assertOpenMonth(month: string, instead: string) {
    const locked = firstLocked(await lockedMonths(this.prisma, [month]));
    if (locked) throw new ConflictException(`${payrollIs(locked.month, locked.status)}, so its deductions can't be changed: ${instead}.`);
  }

  /** Why it isn't deducted in a month. */
  private notDeductedText(row: RecurringRow, month: string): string {
    const last = lastMonthOf(recurringMonths(row));
    return last === null ? `It isn't deducted in ${monthName(month)}.` : `It isn't deducted in ${monthName(month)}: its last month is ${monthName(last)}.`;
  }

  /**
   * Its months' Recurring deductions still pending from `from` on: to be cancelled (`refuseLocked`: refused when one is
   * in a month whose run is with the CEO, the run the CEO approves; else only those in months not locked).
   */
  private async pendingFrom(row: RecurringRow, from: string, refuseLocked = true): Promise<{ id: string; month: string }[]> {
    const pending = row.deductions.filter((d) => d.status === 'pending' && monthOfDate(d.month) >= from).map((d) => ({ id: d.id, month: monthOfDate(d.month) }));
    const locked = await lockedMonths(this.prisma, pending.map((p) => p.month));
    const withCeo = pending.find((p) => locked.get(p.month) === 'pending_ceo');
    if (refuseLocked && withCeo) {
      throw new ConflictException(`Its ${monthName(withCeo.month)} deduction is on the payroll with the CEO: ask the CEO to return the run first.`);
    }
    return refuseLocked ? pending : pending.filter((p) => !locked.has(p.month));
  }

  private async cancel(db: Db, rows: readonly { id: string }[], user: SessionUser) {
    if (!rows.length) return;
    await db.payrollAdjustment.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: 'pending' }, data: { status: 'cancelled', cancelledById: user.id, cancelledAt: new Date() } });
  }

  private async recordCancelled(row: { id: string; employee: { employeeCode: string } }, cancelled: readonly { id: string; month: string }[], user: SessionUser) {
    for (const c of cancelled) {
      await this.audit.record({
        userId: user.id,
        action: 'cancel',
        entityType: ADJUSTMENT,
        entityId: c.id,
        diff: { employeeCode: row.employee.employeeCode, month: c.month, kind: 'deduction', type: RECURRING_TYPE, status: { from: 'pending', to: 'cancelled' }, recurringId: row.id },
      });
    }
  }

  /** A draft run of one of its months from `from` on takes it at once: added, and the draft's line worked out again. */
  private async addToDrafts(recurringId: string, from: string, user: SessionUser) {
    const drafts = await this.prisma.payrollRun.findMany({ where: { status: 'draft', month: { gte: toDateOnly(firstDay(from)) } }, select: { month: true } });
    const added: string[] = [];
    for (const d of drafts) {
      const month = monthOfDate(d.month);
      if (await this.addToMonth(month, user, { recurringId })) added.push(month);
    }
    if (!added.length) return;
    const { employeeId } = await this.prisma.recurringDeduction.findUniqueOrThrow({ where: { id: recurringId }, select: { employeeId: true } });
    await this.runs.syncDrafts(added, [employeeId], user);
  }
}
