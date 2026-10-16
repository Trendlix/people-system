import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  bankNamed,
  EMPTY_PAYROLL_INPUTS,
  payrollLine,
  type PayBasis,
  type PayrollInputs,
  type PayrollRules,
  type PayrollStatus,
  type PayrollTerms,
} from '@trendlix/shared';
import { ALLOWANCE_ORDER } from '../allowances/rows.js';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { inFile, lineBank, type BankDetails, type BankFileKind } from './bank.js';
import { achWorkbook, cibWorkbook } from './bank-files.js';
import { firstDay, lastDay, monthName, monthShort, monthsLater } from './months.js';
import type { CibFileQueryDto, CreatePayrollRunDto, PaidPayrollDto, ReturnPayrollDto, UpdatePayrollLinesDto } from './payroll.dto.js';
import { PayrollSettingsService, rulesOf } from './payroll-settings.service.js';
import { PayslipsService } from './payslips.service.js';
import { registerWorkbook } from './register.js';
import { roster, type RosterEmployment, type RosterLine } from './roster.js';
import { STATUS_TEXT } from './status.js';
import {
  bankDetailsOf,
  isApproved,
  monthOf,
  RUN_INCLUDE,
  runView,
  TOTAL_KEYS,
  totalsOf,
  type LineRow,
  type PayrollRunSummary,
  type PayrollRunView,
  type RunRow,
} from './views.js';

const RUN = 'payroll_run';
const LINE = 'payroll_line';

/** Inputs that are money: the audit log only says they changed, as for a contract's salary. */
const MONEY_INPUTS: readonly (keyof PayrollInputs)[] = ['commission', 'settlements', 'released'];

/**
 * A line's saved inputs, only those there are today: one saved before it was taken off (the medical subscription,
 * owner's decision, 16 October 2026) is dropped when the line is refreshed or changed.
 */
const savedInputs = (saved: Prisma.JsonValue): PayrollInputs => {
  const values = (saved ?? {}) as Partial<PayrollInputs>;
  const fields = Object.keys(EMPTY_PAYROLL_INPUTS) as (keyof PayrollInputs)[];
  return Object.fromEntries(fields.map((k) => [k, values[k] ?? null])) as unknown as PayrollInputs;
};

/** The employments that may be on a month's run, with what the roster needs of them. */
const rosterSelect = (from: Date, to: Date) =>
  ({
    id: true,
    employmentType: true,
    joinDate: true,
    endDate: true,
    department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
    jobTitle: { select: { titleEn: true } },
    employee: { select: { id: true, employeeCode: true, fullNameEn: true, socialInsured: true, insuranceComprehensiveWage: true } },
    // signed versions (active, superseded or ended) that may be in force in the month
    contracts: {
      where: { status: { not: 'draft' }, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        payBasis: true,
        grossSalary: true,
        basicPercent: true,
        hourlyRate: true,
        allowances: { orderBy: ALLOWANCE_ORDER, select: { nameEn: true, amount: true, taxable: true, insured: true } },
      },
    },
  }) satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: ReturnType<typeof rosterSelect> }>;

function rosterEmployment(e: EmploymentRow): RosterEmployment {
  return {
    id: e.id,
    employmentType: e.employmentType,
    joinDate: fromDateOnly(e.joinDate),
    endDate: fromDateOnly(e.endDate),
    department: e.department,
    jobTitle: e.jobTitle?.titleEn ?? null,
    employee: { ...e.employee, insuranceComprehensiveWage: e.employee.insuranceComprehensiveWage?.toNumber() ?? null },
    contracts: e.contracts.map((c) => ({
      id: c.id,
      startDate: fromDateOnly(c.startDate),
      endDate: fromDateOnly(c.endDate),
      payBasis: c.payBasis as PayBasis,
      grossSalary: c.grossSalary.toNumber(),
      basicPercent: c.basicPercent,
      hourlyRate: c.hourlyRate?.toNumber() ?? null,
      allowances: c.allowances.map((a) => ({ ...a, amount: a.amount.toNumber() })),
    })),
  };
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** A line worked out: its result, and the result's totals for their columns. */
function worked(terms: PayrollTerms, inputs: PayrollInputs, rules: PayrollRules) {
  const result = payrollLine(terms, inputs, rules);
  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, result[k]])) as Record<(typeof TOTAL_KEYS)[number], number>;
  return { result: json(result), ...totals };
}

/** What a line keeps of the roster: who, what is shown with it, and its terms. */
const fromRoster = (l: RosterLine) => ({
  employmentId: l.employmentId,
  contractId: l.contractId,
  employeeCode: l.employeeCode,
  nameEn: l.nameEn,
  department: l.department,
  jobTitle: l.jobTitle,
  employmentType: l.employmentType,
  payBasis: l.payBasis,
  terms: json(l.terms),
});

/** The fields that were sent (undefined means "leave as it is"). */
const sent = <T extends object>(dto: T) => Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;

// Monthly payroll runs (owner's decisions, 16 October 2026). HR makes a month's run: everyone with a signed contract in
// force in the month, with the contract's terms and the profile's social insurance, worked out with the settings' rules
// (packages/shared payroll.ts); HR types the month's inputs, refreshes it as contracts change (the inputs stay), and
// sends it to the CEO. The CEO approves it or returns it with a reason; approving locks it and copies each line's bank
// details, from which the bank files are made (CIB's payroll system for CIB accounts, ACH for every other bank). HR
// marks it paid. HR, Finance and the CEO see runs; every change of status, every input changed and every bank file
// downloaded is in the audit log. A Super Admin deletes a draft made by mistake.
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: PayrollSettingsService,
    private readonly payslips: PayslipsService,
  ) {}

  /** Every run, newest month first, with its totals. */
  async list(): Promise<PayrollRunSummary[]> {
    const [runs, sums] = await Promise.all([
      this.prisma.payrollRun.findMany({ orderBy: { month: 'desc' } }),
      this.prisma.payrollLine.groupBy({
        by: ['runId'],
        _count: { _all: true },
        _sum: Object.fromEntries(TOTAL_KEYS.map((k) => [k, true])) as Record<(typeof TOTAL_KEYS)[number], true>,
      }),
    ]);
    const byRun = new Map(sums.map((s) => [s.runId, s]));
    return runs.map((r) => {
      const s = byRun.get(r.id);
      const totals = totalsOf([]);
      totals.employees = s?._count._all ?? 0;
      for (const k of TOTAL_KEYS) totals[k] = s?._sum[k]?.toNumber() ?? 0;
      return { id: r.id, month: monthOf(r), status: r.status as PayrollStatus, totals, createdAt: r.createdAt, approvedAt: r.approvedAt, paidOn: fromDateOnly(r.paidOn) };
    });
  }

  async get(id: string): Promise<PayrollRunView> {
    return this.view(await this.row(id));
  }

  /** A month's run, from 12 months back to next month: one per month. Its rules are the settings' as they are now. */
  async create(dto: CreatePayrollRunDto, user: SessionUser): Promise<PayrollRunView> {
    const month = dto.month;
    const current = todayInCairo().slice(0, 7);
    const [earliest, latest] = [monthsLater(current, -12), monthsLater(current, 1)];
    if (month < earliest || month > latest) throw new BadRequestException(`Choose a month from ${monthName(earliest)} to ${monthName(latest)}.`);
    if (await this.prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { id: true } })) {
      throw new ConflictException(`There is already a payroll for ${monthName(month)}.`);
    }

    const rules = rulesOf(await this.settings.row());
    const { lines, exclusions } = await this.roster(month, rules);
    const run = await this.prisma.$transaction(async (tx) => {
      const made = await tx.payrollRun.create({ data: { month: toDateOnly(firstDay(month)), rules: json(rules), exclusions: json(exclusions), createdById: user.id } });
      await tx.payrollLine.createMany({
        data: lines.map((l) => ({ runId: made.id, employeeId: l.employeeId, ...fromRoster(l), inputs: json(EMPTY_PAYROLL_INPUTS), ...worked(l.terms, EMPTY_PAYROLL_INPUTS, rules) })),
      });
      return made;
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: RUN,
      entityId: run.id,
      diff: { month, status: 'draft', rules, employees: lines.length, excluded: exclusions.map((x) => x.employeeCode) },
    });
    return this.get(run.id);
  }

  /**
   * Takes a draft's people, contracts, insured wages and rules again as they are now: someone newly under contract is
   * added, someone no longer is taken off, everyone's terms are taken afresh; the inputs typed, the holds and the
   * comments stay.
   */
  async refresh(id: string, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    const month = monthOf(run);
    this.assertStatus(run, 'draft', 'refreshed');
    const rules = rulesOf(await this.settings.row());
    const { lines, exclusions } = await this.roster(month, rules);
    const kept = new Map(run.lines.map((l) => [l.employeeId, l]));
    const staying = new Set(lines.map((l) => l.employeeId));
    const removed = run.lines.filter((l) => !staying.has(l.employeeId));
    const added = lines.filter((l) => !kept.has(l.employeeId));

    await this.prisma.$transaction([
      this.prisma.payrollLine.deleteMany({ where: { id: { in: removed.map((l) => l.id) } } }),
      ...lines.map((l) => {
        const before = kept.get(l.employeeId);
        const inputs = before ? savedInputs(before.inputs) : EMPTY_PAYROLL_INPUTS;
        const data = { ...fromRoster(l), inputs: json(inputs), ...worked(l.terms, inputs, rules) };
        return before
          ? this.prisma.payrollLine.update({ where: { id: before.id }, data })
          : this.prisma.payrollLine.create({ data: { runId: id, employeeId: l.employeeId, ...data } });
      }),
      this.prisma.payrollRun.update({ where: { id }, data: { rules: json(rules), exclusions: json(exclusions) } }),
    ]);
    // compared rule by rule: the database keeps them in an order of its own
    const ruleChanges = changes(run.rules as unknown as Record<string, unknown>, rules as unknown as Record<string, unknown>);
    await this.audit.record({
      userId: user.id,
      action: 'refresh',
      entityType: RUN,
      entityId: id,
      diff: {
        month,
        added: added.map((l) => l.employeeCode),
        removed: removed.map((l) => l.employeeCode),
        ...(Object.keys(ruleChanges).length && { rules: ruleChanges }),
      },
    });
    return this.get(id);
  }

  /**
   * Changes a draft's lines: their inputs (null clears one), holds and comments. Each changed line is worked out again
   * with the run's rules; the audit log has what changed, the money inputs only as changed.
   */
  async updateLines(id: string, dto: UpdatePayrollLinesDto, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    const month = monthOf(run);
    this.assertStatus(run, 'draft', 'changed');
    const ids = dto.lines.map((l) => l.id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Send each line once.');
    const lines = new Map(run.lines.map((l) => [l.id, l]));
    if (ids.some((x) => !lines.has(x))) throw new BadRequestException('Some of these lines are not on this payroll. Reload it and try again.');
    const rules = run.rules as unknown as PayrollRules;

    const updates: { line: LineRow; data: Prisma.PayrollLineUpdateInput; diff: Record<string, unknown> }[] = [];
    for (const change of dto.lines) {
      const line = lines.get(change.id)!;
      const was = savedInputs(line.inputs);
      const inputs: PayrollInputs = { ...was, ...(change.inputs ? sent(change.inputs) : {}) };
      const diff: Record<string, unknown> = changes(was as unknown as Record<string, unknown>, inputs as unknown as Record<string, unknown>);
      for (const key of MONEY_INPUTS) if (key in diff) diff[key] = 'changed';
      Object.assign(diff, changes({ onHold: line.onHold, comments: line.comments }, { onHold: change.onHold, comments: change.comments }));
      if (!Object.keys(diff).length) continue;
      updates.push({
        line,
        data: { inputs: json(inputs), onHold: change.onHold, comments: change.comments, ...worked(line.terms as unknown as PayrollTerms, inputs, rules) },
        diff,
      });
    }

    await this.prisma.$transaction(updates.map((u) => this.prisma.payrollLine.update({ where: { id: u.line.id }, data: u.data })));
    for (const u of updates) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: LINE, entityId: u.line.id, diff: { runId: id, month, employeeCode: u.line.employeeCode, ...u.diff } });
    }
    return this.get(id);
  }

  /** HR sends a draft to the CEO. */
  async submit(id: string, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    this.assertStatus(run, 'draft', 'sent to the CEO');
    if (!run.lines.length) throw new ConflictException(`Nobody is on the ${monthName(monthOf(run))} payroll. Refresh it once the contracts are signed.`);
    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'pending_ceo', submittedAt: new Date(), returnedReason: null } });
    await this.statusChanged(run, 'pending_ceo', 'submit', user);
    return this.get(id);
  }

  /** The CEO sends it back to HR, saying why; HR changes it and sends it again. */
  async returnToHr(id: string, dto: ReturnPayrollDto, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    this.assertStatus(run, 'pending_ceo', 'returned');
    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'draft', returnedReason: dto.reason } });
    await this.statusChanged(run, 'draft', 'return', user, { reason: dto.reason });
    return this.get(id);
  }

  /**
   * The CEO approves it (the CEO only: owner's decision, 16 October 2026). It is locked from now on, and each line's
   * bank details are copied, so the bank files pay what was approved.
   */
  async approve(id: string, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    this.assertStatus(run, 'pending_ceo', 'approved');
    const banks = await this.banks(run.lines.map((l) => l.employeeId));
    await this.prisma.$transaction([
      ...run.lines.map((l) => {
        const b = banks.get(l.employeeId);
        return this.prisma.payrollLine.update({
          where: { id: l.id },
          // a bank not on the EG-ACH list is kept as typed, so the problem still reads as such
          data: { bankShort: b?.bank ? (bankNamed(b.bank)?.short ?? b.bank) : null, accountNo: b?.accountNo ?? null, iban: b?.iban ?? null, holderName: b?.holderName ?? null },
        });
      }),
      this.prisma.payrollRun.update({ where: { id }, data: { status: 'approved', approvedById: user.id, approvedAt: new Date() } }),
    ]);
    await this.statusChanged(run, 'approved', 'approve', user);
    return this.get(id);
  }

  /**
   * HR records the day the salaries were paid: not in the future, nor before the month began. Then everyone paid (not
   * on hold) gets their English payslip (owner's decisions, 16 October 2026); one that can't be drawn doesn't stop the
   * run being marked paid, and is drawn when first downloaded.
   */
  async markPaid(id: string, dto: PaidPayrollDto, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    const month = monthOf(run);
    this.assertStatus(run, 'approved', 'marked paid');
    if (dto.paidOn > todayInCairo()) throw new BadRequestException("The payment date can't be in the future.");
    if (dto.paidOn < firstDay(month)) throw new BadRequestException(`The ${monthName(month)} salaries can't have been paid before ${shownDate(firstDay(month))}.`);
    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'paid', paidOn: toDateOnly(dto.paidOn) } });
    await this.statusChanged(run, 'paid', 'paid', user, { paidOn: dto.paidOn });
    await this.payslips.issueRun(id, user);
    return this.get(id);
  }

  /** Deletes a draft made by mistake (a Super Admin only, like every deletion: owner's decision, 15 October 2026). */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const run = await this.row(id);
    const month = monthOf(run);
    if (run.status !== 'draft') throw new ConflictException(`The ${monthName(month)} payroll ${STATUS_TEXT[run.status as PayrollStatus]}: only a draft can be deleted.`);
    await this.prisma.payrollRun.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: RUN, entityId: id, diff: { month, status: run.status, employees: run.lines.length } });
  }

  // ---------- files ----------

  /** The payroll register, whatever the status. */
  async register(id: string): Promise<{ fileName: string; data: Buffer }> {
    const view = await this.get(id);
    const data = await registerWorkbook({
      month: view.month,
      status: view.status,
      paidOn: view.paidOn,
      lines: view.lines.map((l) => ({
        department: l.department,
        employeeCode: l.employeeCode,
        name: l.name,
        jobTitle: l.jobTitle,
        payBasis: l.payBasis,
        terms: l.terms,
        inputs: l.inputs,
        result: l.result,
        bankFile: l.bank.problem === null ? l.bank.file : null,
        onHold: l.onHold,
        comments: l.comments,
      })),
    });
    return { fileName: `Payroll ${monthName(view.month)}${view.status === 'draft' ? ' (draft)' : ''}.xlsx`, data };
  }

  /**
   * A bank file, once the CEO has approved the run: the lines paid through that file (not on hold, something to
   * transfer, bank details it can pay), with the bank details copied at the approval. Every download is in the audit
   * log.
   */
  async bankFile(id: string, kind: BankFileKind, query: CibFileQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const run = await this.row(id);
    const month = monthOf(run);
    if (!isApproved(run.status)) {
      throw new ConflictException(`The ${monthName(month)} payroll ${STATUS_TEXT[run.status as PayrollStatus]}: the bank files are made once the CEO approves it.`);
    }
    const lines = run.lines
      .map((l) => ({ line: l, details: bankDetailsOf(l, undefined, true), transfer: l.transfer.toNumber() }))
      .filter((x) => inFile({ onHold: x.line.onHold, transfer: x.transfer, bank: lineBank(x.details) }, kind));
    if (!lines.length) {
      throw new ConflictException(`Nobody on the ${monthName(month)} payroll is paid through the ${kind === 'cib' ? 'CIB' : 'ACH'} file.`);
    }
    const holder = (x: (typeof lines)[number]) => x.details.holderName ?? x.line.nameEn;

    let data: Buffer;
    let fileName: string;
    const today = todayInCairo();
    const valueDate = query.valueDate ?? today;
    if (kind === 'cib') {
      const s = await this.settings.row();
      if (!s.cibDebitAccount || !s.cibDebitAccountName) {
        throw new ConflictException("Enter the company's CIB account and its name in the payroll settings first: the CIB file pays the salaries from it.");
      }
      data = await cibWorkbook({
        fileDate: today,
        valueDate,
        month,
        debitAccount: s.cibDebitAccount,
        debitAccountName: s.cibDebitAccountName,
        lines: lines.map((x) => ({ account: x.details.accountNo!, name: holder(x), amount: x.transfer })),
      });
      fileName = `CIB ${monthShort(month)} ${month.slice(0, 4)} Salaries.xlsx`;
    } else {
      const s = await this.settings.row();
      data = await achWorkbook({
        month,
        purpose: s.achPurpose,
        lines: lines.map((x) => ({ name: holder(x), account: x.details.iban ?? x.details.accountNo!, bankShort: lineBank(x.details).bankShort!, amount: x.transfer })),
      });
      fileName = `ACH Salaries Batch ${monthShort(month)} ${month.slice(0, 4)}.xlsx`;
    }
    await this.audit.record({
      userId: user.id,
      action: 'payroll_bank_file',
      entityType: RUN,
      entityId: id,
      diff: { month, file: kind, employees: lines.map((x) => x.line.employeeCode), ...(kind === 'cib' && { valueDate }) },
    });
    return { fileName, data };
  }

  // ---------- helpers ----------

  private async row(id: string): Promise<RunRow> {
    const run = await this.prisma.payrollRun.findUnique({ where: { id }, include: RUN_INCLUDE });
    if (!run) throw new NotFoundException('Payroll not found.');
    return run;
  }

  /** Who is on the month's run, and who is left out, as the employments and contracts are now. */
  private async roster(month: string, rules: PayrollRules) {
    const from = toDateOnly(firstDay(month));
    const to = toDateOnly(lastDay(month));
    const rows = await this.prisma.employment.findMany({
      where: { joinDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] },
      select: rosterSelect(from, to),
    });
    return roster(month, rows.map(rosterEmployment), rules);
  }

  /** The employees' bank details as they are now, by employee. Read in full here, never sent. */
  private async banks(employeeIds: string[]): Promise<Map<string, BankDetails>> {
    const rows = await this.prisma.employeeBank.findMany({ where: { employeeId: { in: employeeIds } } });
    return new Map(rows.map((b) => [b.employeeId, { bank: b.bankName, accountNo: b.accountNo, iban: b.iban, holderName: b.holderName }]));
  }

  private async view(run: RunRow): Promise<PayrollRunView> {
    const [banks, approver] = await Promise.all([
      isApproved(run.status) ? new Map<string, BankDetails>() : this.banks(run.lines.map((l) => l.employeeId)),
      run.approvedBy ? this.prisma.employee.findUnique({ where: { workEmail: run.approvedBy.email.toLowerCase() }, select: { fullNameEn: true } }) : null,
    ]);
    return runView(run, { banks, approvedByName: approver?.fullNameEn ?? null });
  }

  private assertStatus(run: RunRow, wanted: PayrollStatus, doing: string) {
    if (run.status !== wanted) {
      throw new ConflictException(`The ${monthName(monthOf(run))} payroll ${STATUS_TEXT[run.status as PayrollStatus]}, so it can't be ${doing}.`);
    }
  }

  private statusChanged(run: RunRow, to: PayrollStatus, action: string, user: SessionUser, more: Record<string, unknown> = {}) {
    return this.audit.record({ userId: user.id, action, entityType: RUN, entityId: run.id, diff: { month: monthOf(run), status: { from: run.status, to }, ...more } });
  }
}
