import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ACCOUNTS_ALLOWANCE,
  changedDays,
  lockedAmong,
  lockedMonthRefusal,
  OVERLAP_REFUSAL,
  periodsOverlap,
  shownDay,
  type ClientAccountStatus,
  type LockedPayrollStatus,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { actsAs, assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { seesSalary, isSelf } from '../employees/access.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateAssignmentDto,
  CreateClientAccountDto,
  CreateTierDto,
  EndClientAccountDto,
  UpdateAssignmentDto,
  UpdateClientAccountDto,
  UpdateTierDto,
} from './client-accounts.dto.js';
import { ACCOUNT_INCLUDE, accountView, ASSIGNMENT_INCLUDE, assignmentView, byStanding, type AssignmentView } from './views.js';

const ACCOUNT = 'client_account';
const ASSIGNMENT = 'client_account_assignment';
const TIER = 'client_account_tier';

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

/** An assignment's period and amount, as the rules read it. */
interface Held {
  from: string;
  to: string | null;
  amount: number;
}

/** The roles that see the Client Accounts page: HR, the CEO, Finance (read only) and a Super Admin. */
export const READS_ACCOUNTS = ['hr', 'ceo', 'finance', 'super_admin'] as const;
/** The roles that add, change and end accounts and their assignments: HR and the CEO. */
export const EDITS_ACCOUNTS = ['hr', 'ceo'] as const;

/** The latest day a payroll month is looked for (an open end runs on for good). */
const LATEST = '2999-12-31';

const edits = (user: SessionUser) => !user.developer && actsAs(user.roles, [...EDITS_ACCOUNTS]);
const money = (n: Prisma.Decimal | number | null | undefined) => (n === null || n === undefined ? null : typeof n === 'number' ? n : n.toNumber());

// Client accounts (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal with it?";
// asked, a "Client accounts list", the rate "variable", "By days"; packages/shared client-accounts.ts): the accounts,
// their optional size tiers, and the people assigned to them, each assignment with its dates and amount a month (the
// account's default unless HR types another). HR and the CEO add, change and end them; Finance and a Super Admin read
// them; the amounts are RESTRICTED like the salary (seesSalary). A C-level person's assignments are hidden from anyone
// who doesn't see C-level people (ConfidentialService), the CEO managing them. An assignment is refused for someone
// without a current employment, or whose contract has no per-account allowance; overlapping the same person on the same
// account; and when a start, an end or an amount would change a month whose payroll is with the CEO, approved or paid
// (they never change). Draft runs take the changes when refreshed. Every write is in the audit log, the amounts only as
// "changed". Clients will hold Projects and Timesheets later.
@Injectable()
export class ClientAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  // ---------- accounts ----------

  /** Every account with its people, the size tiers, and what the caller may do. */
  async list(user: SessionUser) {
    const [rows, tiers, confidential] = await Promise.all([
      this.prisma.clientAccount.findMany({ include: ACCOUNT_INCLUDE, orderBy: [{ status: 'asc' }, { nameEn: 'asc' }] }),
      this.tierRows(),
      this.confidential.view(user),
    ]);
    const sees = seesSalary(user);
    const today = todayInCairo();
    return {
      accounts: rows.map((a) => accountView(a, sees, confidential.hidden, today)),
      tiers: tiers.map((t) => this.tierView(t, sees)),
      seesAmounts: sees,
      edits: edits(user),
    };
  }

  async get(id: string, user: SessionUser) {
    const [row, confidential] = await Promise.all([this.accountRow(id), this.confidential.view(user)]);
    return accountView(row, seesSalary(user), confidential.hidden, todayInCairo());
  }

  /** A new account: its default amount typed, else its size tier's. */
  async create(dto: CreateClientAccountDto, user: SessionUser) {
    await this.assertNameFree(dto.nameEn);
    if (dto.code) await this.assertCodeFree(dto.code);
    const tier = dto.tierId ? await this.tier(dto.tierId) : null;
    if (dto.departmentId) await this.assertDepartment(dto.departmentId);
    const defaultAmount = dto.defaultAmount ?? money(tier?.defaultAmount);
    if (defaultAmount === null) throw new BadRequestException('Enter the default amount a month for the people on this account, or choose a size that has one.');
    const row = await this.prisma.clientAccount.create({
      data: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        code: dto.code ?? null,
        tierId: tier?.id ?? null,
        defaultAmount,
        departmentId: dto.departmentId ?? null,
        notes: dto.notes ?? null,
      },
      include: ACCOUNT_INCLUDE,
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ACCOUNT,
      entityId: row.id,
      diff: {
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        code: row.code,
        tier: tier?.nameEn ?? null,
        departmentId: row.departmentId,
        // money never goes to the audit log: only that it was set (as a contract's salary)
        defaultAmount: 'changed',
      },
    });
    return this.get(row.id, user);
  }

  /** Changes an account: its default only fills in the next people assigned, those on it keep their own amounts. */
  async update(id: string, dto: UpdateClientAccountDto, user: SessionUser) {
    const before = await this.accountRow(id);
    if (dto.nameEn !== undefined && dto.nameEn.toLowerCase() !== before.nameEn.toLowerCase()) await this.assertNameFree(dto.nameEn, id);
    if (dto.code && dto.code.toLowerCase() !== (before.code ?? '').toLowerCase()) await this.assertCodeFree(dto.code, id);
    const tier = dto.tierId ? await this.tier(dto.tierId) : null;
    if (dto.departmentId) await this.assertDepartment(dto.departmentId);
    // a size chosen anew fills in the default when none is typed
    const defaultAmount = dto.defaultAmount ?? (tier && tier.id !== before.tierId ? tier.defaultAmount.toNumber() : undefined);
    const fields = {
      nameEn: dto.nameEn,
      nameAr: dto.nameAr,
      code: dto.code,
      tierId: dto.tierId,
      departmentId: dto.departmentId,
      notes: dto.notes,
    };
    await this.prisma.clientAccount.update({ where: { id }, data: { ...fields, ...(defaultAmount !== undefined && { defaultAmount }) } });
    const diff: Record<string, unknown> = changes(before as unknown as Record<string, unknown>, fields);
    if (defaultAmount !== undefined && Math.round(defaultAmount * 100) !== Math.round(before.defaultAmount.toNumber() * 100)) diff.defaultAmount = 'changed';
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ACCOUNT, entityId: id, diff: { nameEn: before.nameEn, ...diff } });
    return this.get(id, user);
  }

  /**
   * Ends an account on a day: its people's open assignments end that day (each refused, and so the whole, when it would
   * change a month whose payroll is with the CEO, approved or paid); one starting after it must be changed first. It
   * takes no new assignments from then on.
   */
  async end(id: string, dto: EndClientAccountDto, user: SessionUser) {
    const before = await this.accountRow(id);
    if (before.status === 'ended') throw new ConflictException(`${before.nameEn} ended on ${shownDay(fromDateOnly(before.endedOn)!)} already.`);
    const endedOn = dto.endedOn;
    const open = before.assignments.filter((a) => a.toDate === null || fromDateOnly(a.toDate) > endedOn);
    const later = open.find((a) => fromDateOnly(a.fromDate) > endedOn);
    if (later) {
      throw new ConflictException(`${later.employee.fullNameEn} starts on ${before.nameEn} on ${shownDay(fromDateOnly(later.fromDate))}, after ${shownDay(endedOn)}: change their assignment first.`);
    }
    for (const a of open) await this.assertUnlocked(this.prisma, this.held(a), { ...this.held(a), to: endedOn });
    await this.prisma.$transaction(async (tx) => {
      for (const a of open) await tx.clientAccountAssignment.update({ where: { id: a.id }, data: { toDate: toDateOnly(endedOn) } });
      await tx.clientAccount.update({ where: { id }, data: { status: 'ended', endedOn: toDateOnly(endedOn) } });
    });
    await this.audit.record({
      userId: user.id,
      action: 'end',
      entityType: ACCOUNT,
      entityId: id,
      diff: { nameEn: before.nameEn, status: { from: before.status, to: 'ended' }, endedOn, assignmentsEnded: open.length },
    });
    for (const a of open) {
      await this.audit.record({
        userId: user.id,
        action: 'end',
        entityType: ASSIGNMENT,
        entityId: a.id,
        diff: { accountId: id, account: before.nameEn, employeeId: a.employeeId, employeeCode: a.employee.employeeCode, toDate: { from: fromDateOnly(a.toDate), to: endedOn }, reason: 'account_ended' },
      });
    }
    return this.get(id, user);
  }

  // ---------- assignments ----------

  /**
   * A person on an account: under their current employment, at the amount sent, else their contract's amount per account
   * (27 October 2026), else the account's default.
   */
  async addAssignment(accountId: string, dto: CreateAssignmentDto, user: SessionUser) {
    const account = await this.accountRow(accountId);
    if (account.status === 'ended') throw new ConflictException(`${account.nameEn} ended on ${shownDay(fromDateOnly(account.endedOn)!)}, so nobody can be assigned to it.`);
    await this.confidential.assertVisible(user, dto.employeeId);
    const person = await this.person(dto.employeeId);
    const employment = await this.currentEmployment(person);
    const amount = dto.amount ?? (await this.contractAmount(employment.id)) ?? account.defaultAmount.toNumber();
    const after: Held = { from: dto.fromDate, to: dto.toDate ?? null, amount };
    this.assertDates(after, person.fullNameEn, employment, account);
    await this.assertEligible(person.fullNameEn, employment.id);
    await this.assertNoOverlap(person, account, after);
    await this.assertUnlocked(this.prisma, null, after);
    const row = await this.prisma.clientAccountAssignment.create({
      data: {
        accountId,
        employeeId: person.id,
        employmentId: employment.id,
        fromDate: toDateOnly(after.from),
        toDate: after.to === null ? null : toDateOnly(after.to),
        amount: after.amount,
        note: dto.note ?? null,
      },
      include: ASSIGNMENT_INCLUDE,
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ASSIGNMENT,
      entityId: row.id,
      diff: {
        accountId,
        account: account.nameEn,
        employeeId: person.id,
        employeeCode: person.employeeCode,
        fromDate: after.from,
        toDate: after.to,
        // the default, or typed: only that it was set
        amount: 'changed',
        ...(dto.amount === undefined && { amountFrom: 'account_default' }),
        ...(row.note && { note: row.note }),
      },
    });
    return assignmentView(row, seesSalary(user), todayInCairo());
  }

  /** Changes an assignment's dates (an end date ends it; null opens it again), amount or note. */
  async updateAssignment(id: string, dto: UpdateAssignmentDto, user: SessionUser) {
    const before = await this.assignmentRow(id);
    await this.confidential.assertVisible(user, before.employeeId, 'Assignment not found.');
    const was = this.held(before);
    const after: Held = {
      from: dto.fromDate ?? was.from,
      to: dto.toDate === undefined ? was.to : dto.toDate,
      amount: dto.amount ?? was.amount,
    };
    const employment = await this.prisma.employment.findUniqueOrThrow({ where: { id: before.employmentId }, select: { id: true, joinDate: true, endDate: true } });
    this.assertDates(after, before.employee.fullNameEn, employment, before.account, was);
    await this.assertNoOverlap(before.employee, before.account, after, id);
    await this.assertUnlocked(this.prisma, was, after);
    const note = dto.note === undefined ? before.note : dto.note;
    const row = await this.prisma.clientAccountAssignment.update({
      where: { id },
      data: { fromDate: toDateOnly(after.from), toDate: after.to === null ? null : toDateOnly(after.to), amount: after.amount, note },
      include: ASSIGNMENT_INCLUDE,
    });
    const diff: Record<string, unknown> = changes({ fromDate: was.from, toDate: was.to, note: before.note }, { fromDate: after.from, toDate: after.to, note });
    if (Math.round(after.amount * 100) !== Math.round(was.amount * 100)) diff.amount = 'changed';
    if (Object.keys(diff).length) {
      await this.audit.record({
        userId: user.id,
        // an end date given to an open one ends it
        action: was.to === null && after.to !== null ? 'end' : 'update',
        entityType: ASSIGNMENT,
        entityId: id,
        diff: { accountId: before.accountId, account: before.account.nameEn, employeeId: before.employeeId, employeeCode: before.employee.employeeCode, ...diff },
      });
    }
    return assignmentView(row, seesSalary(user), todayInCairo());
  }

  /** Deletes an assignment made by mistake (a Super Admin only), never one a run with the CEO, approved or paid paid. */
  async removeAssignment(id: string, user: SessionUser) {
    assertDeletes(user);
    const before = await this.assignmentRow(id);
    await this.confidential.assertVisible(user, before.employeeId, 'Assignment not found.');
    await this.assertUnlocked(this.prisma, this.held(before), null);
    await this.prisma.clientAccountAssignment.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: ASSIGNMENT,
      entityId: id,
      diff: { accountId: before.accountId, account: before.account.nameEn, employeeId: before.employeeId, employeeCode: before.employee.employeeCode, fromDate: fromDateOnly(before.fromDate), toDate: fromDateOnly(before.toDate) },
    });
  }

  /**
   * A person's client accounts, for their profile's Employment tab: everything, with the amounts for those who see
   * salaries, for HR, the CEO, Finance and a Super Admin; their current accounts' names and dates alone for the person
   * themself and their direct manager (the amount is on the payslip). 404 for anyone else.
   */
  async forEmployee(employeeId: string, user: SessionUser): Promise<{ assignments: (Omit<AssignmentView, 'employee' | 'employmentId'> & { account: { id: string; nameEn: string; nameAr: string | null; code: string | null; status: ClientAccountStatus } })[]; seesAmounts: boolean; full: boolean }> {
    const full = actsAs(user.roles, [...READS_ACCOUNTS]);
    if (!full && !isSelf(user, { id: employeeId })) {
      const managed = user.employeeId ? await this.prisma.employment.count({ where: { employeeId, endDate: null, managerId: user.employeeId } }) : 0;
      if (!managed) throw new NotFoundException('Employee not found.');
    }
    const sees = full && seesSalary(user);
    const today = todayInCairo();
    const rows = await this.prisma.clientAccountAssignment.findMany({
      where: { employeeId },
      include: { ...ASSIGNMENT_INCLUDE, account: { select: { id: true, nameEn: true, nameAr: true, code: true, status: true } } },
      orderBy: [{ fromDate: 'desc' }],
    });
    const views = rows
      .map((r) => ({ view: assignmentView(r, sees, today), account: r.account }))
      .filter((x) => full || x.view.standing === 'current')
      .sort((a, b) => byStanding(a.view, b.view) || a.account.nameEn.localeCompare(b.account.nameEn));
    return {
      assignments: views.map(({ view, account }) => ({
        id: view.id,
        accountId: view.accountId,
        fromDate: view.fromDate,
        toDate: view.toDate,
        amount: view.amount,
        contractAmount: view.contractAmount,
        // names and dates only for the person and their manager
        note: full ? view.note : null,
        standing: view.standing,
        account: { id: account.id, nameEn: account.nameEn, nameAr: account.nameAr, code: full ? account.code : null, status: account.status as ClientAccountStatus },
      })),
      seesAmounts: sees,
      full,
    };
  }

  // ---------- size tiers ----------

  async tiers(user: SessionUser) {
    const sees = seesSalary(user);
    return (await this.tierRows()).map((t) => this.tierView(t, sees));
  }

  async createTier(dto: CreateTierDto, user: SessionUser) {
    await this.assertTierFree(dto.nameEn);
    const { _max } = await this.prisma.clientAccountTier.aggregate({ _max: { sortOrder: true } });
    const row = await this.prisma.clientAccountTier.create({ data: { nameEn: dto.nameEn, defaultAmount: dto.defaultAmount, sortOrder: (_max.sortOrder ?? 0) + 1 } });
    await this.audit.record({ userId: user.id, action: 'create', entityType: TIER, entityId: row.id, diff: { nameEn: row.nameEn, defaultAmount: 'changed', sortOrder: row.sortOrder } });
    return (await this.tiers(user)).find((t) => t.id === row.id)!;
  }

  async updateTier(id: string, dto: UpdateTierDto, user: SessionUser) {
    const before = await this.tier(id);
    if (dto.nameEn !== undefined && dto.nameEn.toLowerCase() !== before.nameEn.toLowerCase()) await this.assertTierFree(dto.nameEn, id);
    await this.prisma.clientAccountTier.update({ where: { id }, data: { nameEn: dto.nameEn, defaultAmount: dto.defaultAmount, sortOrder: dto.sortOrder } });
    const diff: Record<string, unknown> = changes(before as unknown as Record<string, unknown>, { nameEn: dto.nameEn, sortOrder: dto.sortOrder });
    if (dto.defaultAmount !== undefined && Math.round(dto.defaultAmount * 100) !== Math.round(before.defaultAmount.toNumber() * 100)) diff.defaultAmount = 'changed';
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: TIER, entityId: id, diff: { nameEn: before.nameEn, ...diff } });
    return (await this.tiers(user)).find((t) => t.id === id)!;
  }

  /** Deletes a size (a Super Admin only): the accounts of that size keep their defaults, with no size. */
  async removeTier(id: string, user: SessionUser) {
    assertDeletes(user);
    const before = await this.tier(id);
    await this.prisma.clientAccountTier.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: TIER, entityId: id, diff: { nameEn: before.nameEn } });
  }

  // ---------- helpers ----------

  private tierRows() {
    return this.prisma.clientAccountTier.findMany({ orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }], include: { _count: { select: { accounts: true } } } });
  }

  private tierView(t: Awaited<ReturnType<ClientAccountsService['tierRows']>>[number], sees: boolean) {
    return { id: t.id, nameEn: t.nameEn, defaultAmount: sees ? t.defaultAmount.toNumber() : null, sortOrder: t.sortOrder, accounts: t._count.accounts };
  }

  private async tier(id: string) {
    const row = await this.prisma.clientAccountTier.findUnique({ where: { id } });
    if (!row) throw new BadRequestException('That size is no longer on the list. Reload the page and choose it again.');
    return row;
  }

  private async accountRow(id: string) {
    const row = await this.prisma.clientAccount.findUnique({ where: { id }, include: ACCOUNT_INCLUDE });
    if (!row) throw new NotFoundException('Client account not found.');
    return row;
  }

  private async assignmentRow(id: string) {
    const row = await this.prisma.clientAccountAssignment.findUnique({
      where: { id },
      include: { ...ASSIGNMENT_INCLUDE, account: { select: { id: true, nameEn: true, status: true, endedOn: true } } },
    });
    if (!row) throw new NotFoundException('Assignment not found.');
    return row;
  }

  private held(a: { fromDate: Date; toDate: Date | null; amount: Prisma.Decimal }): Held {
    return { from: fromDateOnly(a.fromDate), to: fromDateOnly(a.toDate), amount: a.amount.toNumber() };
  }

  private async person(id: string) {
    const p = await this.prisma.employee.findUnique({ where: { id }, select: { id: true, employeeCode: true, fullNameEn: true } });
    if (!p) throw new NotFoundException('Employee not found.');
    return p;
  }

  /** The person's current employment (not ended, or ending today or later): refused without one. */
  private async currentEmployment(person: { id: string; fullNameEn: string }) {
    const today = todayInCairo();
    const e = await this.prisma.employment.findFirst({
      where: { employeeId: person.id, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }] },
      orderBy: { joinDate: 'desc' },
      select: { id: true, joinDate: true, endDate: true },
    });
    if (!e) throw new BadRequestException(`${person.fullNameEn} has no current employment, so they can't be assigned to an account.`);
    return e;
  }

  /**
   * The dates make sense: the end on or after the start; within the employment (from its join date, to its last day
   * when it is ending); within the account's life when it has ended.
   */
  private assertDates(
    p: Held,
    name: string,
    employment: { joinDate: Date; endDate: Date | null },
    account: { nameEn: string; status: string; endedOn: Date | null },
    was?: Held,
  ) {
    if (p.to !== null && p.to < p.from) throw new BadRequestException('The end date must be on or after the start date.');
    const join = fromDateOnly(employment.joinDate);
    if (p.from < join && p.from !== was?.from) throw new BadRequestException(`${name} joined on ${shownDay(join)}: date the assignment from then on.`);
    const last = fromDateOnly(employment.endDate);
    if (last !== null && (p.to === null || p.to > last)) throw new BadRequestException(`${name}'s employment ends on ${shownDay(last)}: end the assignment on or before it.`);
    const ended = fromDateOnly(account.endedOn);
    if (account.status === 'ended' && ended !== null && (p.to === null || p.to > ended)) {
      throw new BadRequestException(`${account.nameEn} ended on ${shownDay(ended)}: end the assignment on or before it.`);
    }
  }

  /**
   * The person's contract has a per-account allowance (owner's brief, 25 October 2026: refused otherwise, "saying so"):
   * the employment's signed contract, or a draft of it waiting to be signed (a renewal or a raise adding it).
   */
  private async assertEligible(name: string, employmentId: string) {
    const eligible = await this.prisma.contract.count({ where: { employmentId, status: { in: ['active', 'draft'] }, allowances: { some: { basis: 'per_account' } } } });
    if (eligible) return;
    const kind = await this.prisma.allowanceType.findFirst({ where: { basis: 'per_account', active: true }, orderBy: [{ sortOrder: 'asc' }], select: { nameEn: true } });
    const named = kind?.nameEn ?? ACCOUNTS_ALLOWANCE.nameEn;
    throw new BadRequestException(`${name}'s contract has no ${named}: add it to their contract (or the renewal or raise that adds it), then assign the account.`);
  }

  /** The amount per account the employment's signed contract sets (27 October 2026), if any. */
  private async contractAmount(employmentId: string): Promise<number | null> {
    const row = await this.prisma.contractAllowance.findFirst({
      where: { basis: 'per_account', perAccountAmount: { not: null }, contract: { employmentId, status: 'active' } },
      orderBy: { contract: { version: 'desc' } },
      select: { perAccountAmount: true },
    });
    return row?.perAccountAmount?.toNumber() ?? null;
  }

  /** Never the same person twice on one account on the same day. */
  private async assertNoOverlap(person: { id: string; fullNameEn: string }, account: { id: string; nameEn: string }, p: Held, exceptId?: string) {
    const others = await this.prisma.clientAccountAssignment.findMany({
      where: { employeeId: person.id, accountId: account.id, ...(exceptId && { id: { not: exceptId } }) },
      select: { fromDate: true, toDate: true },
    });
    const clash = others.map((o) => ({ from: fromDateOnly(o.fromDate), to: fromDateOnly(o.toDate) })).find((o) => periodsOverlap(o, p));
    if (clash) throw new ConflictException(OVERLAP_REFUSAL(person.fullNameEn, account.nameEn, clash));
  }

  /**
   * A change never touches a month whose payroll is with the CEO, approved or paid (owner's rule: they never change):
   * refused with the latest such month among the days it changes, saying what to do instead.
   */
  private async assertUnlocked(db: Db, before: Held | null, after: Held | null) {
    const days = changedDays(before, after);
    if (!days.length) return;
    const from = days.reduce((m, d) => (d.from < m ? d.from : m), days[0].from);
    const to = days.reduce((m, d) => (d.to > m ? d.to : m), days[0].to);
    const runs = await db.payrollRun.findMany({
      where: { status: { not: 'draft' }, month: { gte: toDateOnly(`${from.slice(0, 7)}-01`), lte: toDateOnly(`${(to > LATEST ? LATEST : to).slice(0, 7)}-01`) } },
      select: { month: true, status: true },
    });
    const locked = runs.map((r) => ({ month: fromDateOnly(r.month).slice(0, 7), status: r.status as LockedPayrollStatus }));
    const hit = lockedAmong(days, locked);
    if (!hit) return;
    // what to say: a changed amount; else a new one, or its start moved into the month; else its end (or a delete)
    const cents = (n: number) => Math.round(n * 100);
    const what =
      before && after && cents(before.amount) !== cents(after.amount)
        ? 'amount'
        : !before || (after && before.from !== after.from && lockedAmong(changedDays(before, { ...after, to: before.to }), locked))
          ? 'start'
          : 'end';
    throw new ConflictException(lockedMonthRefusal(hit.month, hit.status, what));
  }

  private async assertNameFree(nameEn: string, exceptId?: string) {
    const taken = await this.prisma.clientAccount.findFirst({ where: { nameEn: { equals: nameEn, mode: 'insensitive' }, ...(exceptId && { id: { not: exceptId } }) }, select: { nameEn: true } });
    if (taken) throw new ConflictException(`There is already a client account called ${taken.nameEn}. Choose another name.`);
  }

  private async assertCodeFree(code: string, exceptId?: string) {
    const taken = await this.prisma.clientAccount.findFirst({ where: { code: { equals: code, mode: 'insensitive' }, ...(exceptId && { id: { not: exceptId } }) }, select: { nameEn: true } });
    if (taken) throw new ConflictException(`${taken.nameEn} has the code ${code} already. Choose another code.`);
  }

  private async assertTierFree(nameEn: string, exceptId?: string) {
    const taken = await this.prisma.clientAccountTier.findFirst({ where: { nameEn: { equals: nameEn, mode: 'insensitive' }, ...(exceptId && { id: { not: exceptId } }) }, select: { nameEn: true } });
    if (taken) throw new ConflictException(`There is already a size called ${taken.nameEn}. Choose another name.`);
  }

  private async assertDepartment(id: string) {
    const d = await this.prisma.department.findUnique({ where: { id }, select: { id: true } });
    if (!d) throw new BadRequestException('That department or team is no longer on the list. Reload the page and choose it again.');
  }
}
