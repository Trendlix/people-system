import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  bankNamed,
  changesPayrollLine,
  EMPTY_PAYROLL_INPUTS,
  insuredWageDate,
  formatHours,
  importedInputRefusal,
  importedInputsChanged,
  leaveDaysOf,
  payrollLine,
  PERMISSION_RULE_DEFAULTS,
  permissionHoursText,
  type AttendanceImportMark,
  type LawRates,
  type LeavePay,
  type PayBasis,
  type PayrollInputs,
  type PayrollRules,
  type PayrollStatus,
  type PayrollTerms,
} from '@trendlix/shared';
import { ALLOWANCE_ORDER } from '../allowances/rows.js';
import { AuditService, changes } from '../audit/audit.service.js';
import { AttendanceFillService } from '../attendance/attendance-fill.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import { traineeStagesOf } from '../contracts/views.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GridInputsService } from './adjustments/grid-inputs.service.js';
import { RecurringDeductionsService } from './adjustments/recurring.service.js';
import { RunAdjustmentsService } from './adjustments/run-adjustments.service.js';
import { cleanBankDetails, inFile, lineBank, type BankDetails, type BankFileKind } from './bank.js';
import { achWorkbook, cibWorkbook } from './bank-files.js';
import { ExpectedHoursService } from './expected-hours.service.js';
import { HolidaysService } from './holidays.service.js';
import { LawRatesService } from './law-rates/law-rates.service.js';
import { json, savedInputs, withAdjustments, worked } from './line-work.js';
import { firstDay, lastDay, monthName, monthShort, monthsLater } from './months.js';
import type { AttendanceWaiverDto, CibFileQueryDto, CreatePayrollRunDto, PaidPayrollDto, ReturnPayrollDto, UpdatePayrollLinesDto } from './payroll.dto.js';
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
  runLawRates,
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

/**
 * Inputs that are money: the audit log only says they changed, as for a contract's salary. The commission and the
 * settlements went to Additions / Deductions (owner, 17 October 2026).
 */
const MONEY_INPUTS: readonly (keyof PayrollInputs)[] = ['released'];

/** The employments that may be on a month's run, with what the roster needs of them. */
const rosterSelect = (from: Date, to: Date) =>
  ({
    id: true,
    employmentType: true,
    joinDate: true,
    endDate: true,
    department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
    jobTitle: { select: { titleEn: true } },
    shift: { select: { startTime: true, endTime: true, hoursPerDay: true, workingDays: true } },
    employee: { select: { id: true, employeeCode: true, fullNameEn: true, socialInsured: true, insuranceComprehensiveWage: true } },
    // the approved leave that touches the month (owner, 18 October 2026: "can you apply the leaves according to the
    // law?"): the grid's leave days and unpaid leave days (roster.ts leaveTermsOf)
    leaveRequests: {
      where: { status: 'approved', startDate: { lte: to }, endDate: { gte: from } },
      select: { startDate: true, endDate: true, halfDay: true, type: { select: { paid: true, payPercent: true, calendarDays: true } } },
    },
    // the approved permission in the month (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day"):
    // the grid's permission hours, counted as worked (roster.ts permissionTermsOf)
    permissions: { where: { status: 'approved', date: { gte: from, lte: to } }, select: { date: true, hours: true } },
    // signed versions (active, superseded or ended) that may be in force in the month, and those a raise's insured wage
    // may still stand on (owner's decision, 16 October 2026): ended within 13 months before it, as a raise's insured wage
    // follows its pay at the latest from the next 1 January after it takes effect (raises.ts)
    contracts: {
      where: {
        status: { not: 'draft' },
        startDate: { lte: to },
        OR: [{ endDate: null }, { endDate: { gte: new Date(Date.UTC(from.getUTCFullYear() - 1, from.getUTCMonth() - 1, 1)) } }],
      },
      select: {
        id: true,
        number: true,
        version: true,
        approval: true,
        form2From: true,
        startDate: true,
        endDate: true,
        payBasis: true,
        grossSalary: true,
        basicPercent: true,
        hourlyRate: true,
        // a trainee's training stages: each paid at its own pay in its own days (roster.ts byTraineeStage)
        traineeStages: true,
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
    shift: e.shift && {
      startTime: fromTimeOfDay(e.shift.startTime),
      endTime: fromTimeOfDay(e.shift.endTime),
      hoursPerDay: e.shift.hoursPerDay?.toNumber() ?? null,
      workingDays: e.shift.workingDays,
    },
    employee: { ...e.employee, insuranceComprehensiveWage: e.employee.insuranceComprehensiveWage?.toNumber() ?? null },
    contracts: e.contracts.map((c) => ({
      id: c.id,
      number: c.number,
      version: c.version,
      // a change of pay the CEO approved: the insured wage follows it from the next 1 January, or the Form 2 date
      insuredWageFrom: c.approval === null ? null : insuredWageDate(fromDateOnly(c.startDate), fromDateOnly(c.form2From)),
      startDate: fromDateOnly(c.startDate),
      endDate: fromDateOnly(c.endDate),
      payBasis: c.payBasis as PayBasis,
      grossSalary: c.grossSalary.toNumber(),
      basicPercent: c.basicPercent,
      hourlyRate: c.hourlyRate?.toNumber() ?? null,
      traineeStages: traineeStagesOf(c),
      allowances: c.allowances.map((a) => ({ ...a, amount: a.amount.toNumber() })),
    })),
    leaves: e.leaveRequests.map((l) => ({
      startDate: fromDateOnly(l.startDate),
      endDate: fromDateOnly(l.endDate),
      halfDay: l.halfDay,
      paid: l.type.paid as LeavePay,
      payPercent: l.type.payPercent?.toNumber() ?? null,
      calendarDays: l.type.calendarDays,
    })),
    permissions: e.permissions.map((p) => ({ date: fromDateOnly(p.date), hours: p.hours.toNumber() })),
  };
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

/** How many additions and deductions the run's lines take (owner, 17 October 2026). */
const countOn = (lines: readonly RosterLine[], pending: ReadonlyMap<string, readonly unknown[]>) => lines.reduce((n, l) => n + (pending.get(l.employeeId)?.length ?? 0), 0);

/** The fields that were sent (undefined means "leave as it is"). */
const sent = <T extends object>(dto: T) => Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;

// Monthly payroll runs (owner's decisions, 16 October 2026). HR makes a month's run: everyone with a signed contract in
// force in the month, with the contract's terms and the profile's social insurance, worked out with the settings' rules
// and its year's rates set by law, both copied onto it (packages/shared payroll.ts, law-rates.ts); HR types the month's
// inputs, refreshes it as contracts change (the inputs stay, the rules and rates are taken again), and sends it to the
// CEO. The CEO approves it or returns it with a reason; approving locks it and copies each line's bank
// details, from which the bank files are made (CIB's payroll system for CIB accounts, ACH for every other bank). HR
// marks it paid. HR, Finance and the CEO see runs; every change of status, every input changed and every bank file
// downloaded is in the audit log. A Super Admin deletes a draft made by mistake.
// The month's additions and deductions (owner, 17 October 2026: Additions / Deductions under Payroll) are taken with
// each person's terms when the run is made or refreshed, and as they change while it is a draft
// (adjustments/run-adjustments.service.ts); the CEO's approval applies them to their lines. The grid's bonus and penalty
// days, commission and settlements went there too (owner, 17 October 2026: "instead of there, i think earnings and
// deductions will be enough"): a run the CEO returns has any still typed on it moved (adjustments/grid-inputs.service.ts).
// The expected hours are worked out, never typed (owner, 20 October 2026: "expected hours to be locked based on shifts
// and attendance data"): the shift's less the no-show and leave days; the inputs refuse any (payroll.dto.ts), and a
// draft's line, or a run the CEO returns, has those typed before then cleared (expected-hours.service.ts).
// While the run is with the CEO, the CEO may waive a line's attendance deduction (owner, 17 October 2026: "if there is
// an attendance deduction, allow the CEO to wave the deduction by ticking a box"): the line is worked out again without
// it at once, and the approval takes it as it is.
// Recurring deductions (owner, 18 October 2026, e.g. a medical subscription's share): a run made or refreshed adds the
// month's Recurring deduction of each one due that month first (adjustments/recurring.service.ts), so its lines take
// them with the month's other deductions. Each line's warnings say when it passes the Labour Law's limits (owner, 18
// October 2026, after reading the law: "Block above 10%", "Warn above 25%, record the consent"): its installments of
// advances and loans past 10% of the pay (or Payroll Setup's lower limit), refused when planned but the month's pay can
// be less; its recurring deductions past 25% of the pay after tax, insurance and installments; its damage or loss past
// 5 days' wage. Warnings, never blocks (views.ts lawWarnings).
// C-level people (owner, 19 October 2026: "make C level Employees details not visible to HR"): their lines are hidden
// from anyone but the CEO and a Super Admin, as one row "C-level (N people) — hidden" with no figures, the totals, the
// register, the bank files and the payslips without them; the CEO fills their inputs while the run is a draft (HR with
// Super Admin too; packages/shared changesPayrollLine), and approves the run as now. HR still makes, refreshes and sends
// the whole run.
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: PayrollSettingsService,
    private readonly payslips: PayslipsService,
    private readonly holidays: HolidaysService,
    private readonly lawRates: LawRatesService,
    private readonly adjustments: RunAdjustmentsService,
    private readonly gridInputs: GridInputsService,
    private readonly recurring: RecurringDeductionsService,
    private readonly confidential: ConfidentialService,
    private readonly attendance: AttendanceFillService,
    private readonly expectedHours: ExpectedHoursService,
  ) {}

  /** Every run, newest month first, with its totals: without the C-level people's lines hidden from the caller. */
  async list(user: SessionUser): Promise<PayrollRunSummary[]> {
    const hidden = await this.confidential.hiddenFrom(user);
    const [runs, sums, hiddenSums] = await Promise.all([
      this.prisma.payrollRun.findMany({ orderBy: { month: 'desc' } }),
      this.prisma.payrollLine.groupBy({
        by: ['runId'],
        ...(hidden.length && { where: { employeeId: { notIn: hidden } } }),
        _count: { _all: true },
        _sum: Object.fromEntries(TOTAL_KEYS.map((k) => [k, true])) as Record<(typeof TOTAL_KEYS)[number], true>,
      }),
      hidden.length ? this.prisma.payrollLine.groupBy({ by: ['runId'], where: { employeeId: { in: hidden } }, _count: { _all: true } }) : [],
    ]);
    const byRun = new Map(sums.map((s) => [s.runId, s]));
    const hiddenBy = new Map(hiddenSums.map((s) => [s.runId, s._count._all]));
    return runs.map((r) => {
      const s = byRun.get(r.id);
      const totals = totalsOf([]);
      totals.employees = s?._count._all ?? 0;
      for (const k of TOTAL_KEYS) totals[k] = s?._sum[k]?.toNumber() ?? 0;
      return {
        id: r.id,
        month: monthOf(r),
        status: r.status as PayrollStatus,
        totals,
        hidden: hiddenBy.get(r.id) ?? 0,
        createdAt: r.createdAt,
        approvedAt: r.approvedAt,
        paidOn: fromDateOnly(r.paidOn),
      };
    });
  }

  /** A run as the caller sees it: a C-level person's line only for the CEO and a Super Admin (one hidden row for others). */
  async get(id: string, user: SessionUser): Promise<PayrollRunView> {
    return this.view(await this.row(id), user);
  }

  /**
   * A month's run, from 12 months back to next month: one per month. Its rules are the settings' as they are now, and
   * its rates set by law its year's (owner's request, 16 October 2026), both copied onto it.
   */
  async create(dto: CreatePayrollRunDto, user: SessionUser): Promise<PayrollRunView> {
    const month = dto.month;
    const current = todayInCairo().slice(0, 7);
    const [earliest, latest] = [monthsLater(current, -12), monthsLater(current, 1)];
    if (month < earliest || month > latest) throw new BadRequestException(`Choose a month from ${monthName(earliest)} to ${monthName(latest)}.`);
    if (await this.prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { id: true } })) {
      throw new ConflictException(`There is already a payroll for ${monthName(month)}.`);
    }

    const rules = rulesOf(await this.settings.row());
    const law = await this.lawRates.forYear(Number(month.slice(0, 4)));
    const { lines, exclusions } = await this.roster(month, rules, law);
    // the month's recurring deductions first (18 October 2026), then its additions and deductions (17 October 2026),
    // with each person's terms
    await this.recurring.addToMonth(month, user);
    const pending = await this.adjustments.pendingByEmployee(month);
    const run = await this.prisma.$transaction(async (tx) => {
      const made = await tx.payrollRun.create({
        data: { month: toDateOnly(firstDay(month)), rules: json(rules), lawRates: json(law), exclusions: json(exclusions), createdById: user.id },
      });
      await tx.payrollLine.createMany({
        data: lines.map((l) => {
          const terms = withAdjustments(l.terms, pending.get(l.employeeId));
          return { runId: made.id, employeeId: l.employeeId, ...fromRoster(l), terms: json(terms), inputs: json(EMPTY_PAYROLL_INPUTS), ...worked(terms, EMPTY_PAYROLL_INPUTS, rules, law) };
        }),
      });
      return made;
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: RUN,
      entityId: run.id,
      diff: {
        month,
        status: 'draft',
        rules,
        lawRates: law.year,
        employees: lines.length,
        excluded: exclusions.map((x) => x.employeeCode),
        // how many additions and deductions its lines take, when any
        ...(countOn(lines, pending) && { adjustments: countOn(lines, pending) }),
      },
    });
    // the lines of those who check in on the system filled from the month's attendance days (19 October 2026)
    await this.attendance.fillRun(run.id, user);
    return this.get(run.id, user);
  }

  /**
   * Takes a draft's people, contracts, insured wages, shifts, holidays and rules again as they are now: someone newly
   * under contract is added, someone no longer is taken off, everyone's terms are taken afresh (the expected hours from
   * the shifts and the holidays too), and its year's rates set by law; the inputs typed, the holds and the comments
   * stay.
   */
  async refresh(id: string, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    const month = monthOf(run);
    this.assertStatus(run, 'draft', 'refreshed');
    const rules = rulesOf(await this.settings.row());
    const law = await this.lawRates.forYear(Number(month.slice(0, 4)));
    const { lines, exclusions } = await this.roster(month, rules, law);
    await this.recurring.addToMonth(month, user);
    const pending = await this.adjustments.pendingByEmployee(month);
    const kept = new Map(run.lines.map((l) => [l.employeeId, l]));
    const staying = new Set(lines.map((l) => l.employeeId));
    const removed = run.lines.filter((l) => !staying.has(l.employeeId));
    const added = lines.filter((l) => !kept.has(l.employeeId));

    await this.prisma.$transaction([
      this.prisma.payrollLine.deleteMany({ where: { id: { in: removed.map((l) => l.id) } } }),
      ...lines.map((l) => {
        const before = kept.get(l.employeeId);
        const inputs = before ? savedInputs(before.inputs) : EMPTY_PAYROLL_INPUTS;
        const terms = withAdjustments(l.terms, pending.get(l.employeeId));
        const data = { ...fromRoster(l), terms: json(terms), inputs: json(inputs), ...worked(terms, inputs, rules, law) };
        return before
          ? this.prisma.payrollLine.update({ where: { id: before.id }, data })
          : this.prisma.payrollLine.create({ data: { runId: id, employeeId: l.employeeId, ...data } });
      }),
      this.prisma.payrollRun.update({ where: { id }, data: { rules: json(rules), lawRates: json(law), exclusions: json(exclusions) } }),
    ]);
    // compared rule by rule: the database keeps them in an order of its own
    const ruleChanges = changes(run.rules as unknown as Record<string, unknown>, rules as unknown as Record<string, unknown>);
    // and the rates set by law the same way, in their fixed shape
    const lawChanges = changes(runLawRates(run) as unknown as Record<string, unknown>, law as unknown as Record<string, unknown>);
    await this.audit.record({
      userId: user.id,
      action: 'refresh',
      entityType: RUN,
      entityId: id,
      diff: {
        month,
        added: added.map((l) => l.employeeCode),
        removed: removed.map((l) => l.employeeCode),
        ...(countOn(lines, pending) && { adjustments: countOn(lines, pending) }),
        ...(Object.keys(ruleChanges).length && { rules: ruleChanges }),
        ...(Object.keys(lawChanges).length && { lawRates: lawChanges }),
      },
    });
    // and from the month's attendance days as they are now (19 October 2026)
    await this.attendance.fillRun(id, user);
    return this.get(id, user);
  }

  /**
   * Refresh from attendance (owner's brief, 19 October 2026: "a 'Refresh from attendance' on the run recomputes them"):
   * a draft's lines of those whose month has days of the system's own (their check-ins on the system, a correction
   * approved) filled again from the month's attendance days, the working days gone by without a check-in up to yesterday
   * among them (attendance-fill.service.ts); Zoho's imports stay as they were applied.
   */
  async refreshAttendance(id: string, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    this.assertStatus(run, 'draft', 'refreshed from attendance');
    const result = await this.attendance.fillRun(id, user);
    await this.audit.record({ userId: user.id, action: 'refresh_attendance', entityType: RUN, entityId: id, diff: { month: monthOf(run), ...result } });
    return this.get(id, user);
  }

  /**
   * Changes a draft's lines: their inputs (null clears one), holds and comments; a line's leave days no more than its
   * days paid, its permission hours no more than the Leave Setup's hours a month (19 October 2026); never an input an
   * attendance import filled (409: owner, 19 October 2026, "imported data shouldn't be editable"), nor the expected
   * hours, always worked out from the shift (400 from the DTO: owner, 20 October 2026, "expected hours to be locked
   * based on shifts and attendance data"). Each changed line is worked out again with the run's rules and rates set by
   * law; the audit log has what changed (the leave days too), the money inputs only as changed.
   */
  async updateLines(id: string, dto: UpdatePayrollLinesDto, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    const month = monthOf(run);
    this.assertStatus(run, 'draft', 'changed');
    const ids = dto.lines.map((l) => l.id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Send each line once.');
    // a C-level person's line isn't there for those it is hidden from (owner, 19 October 2026)
    const confidential = await this.confidential.view(user);
    const lines = new Map(run.lines.filter((l) => !confidential.hidden.has(l.employeeId)).map((l) => [l.id, l]));
    if (ids.some((x) => !lines.has(x))) throw new BadRequestException('Some of these lines are not on this payroll. Reload it and try again.');
    // HR changes the lines; a C-level person's the CEO fills (owner, 19 October 2026: "the CEO fills their inputs"), or HR
    // with Super Admin
    const refused = ids.map((x) => lines.get(x)!).filter((l) => !changesPayrollLine(user, confidential.all.has(l.employeeId)));
    if (refused.length) {
      throw new ForbiddenException(
        confidential.all.has(refused[0].employeeId)
          ? `${refused[0].nameEn} is C-level: the CEO fills their line.`
          : `HR fills ${refused[0].nameEn}'s line: the CEO fills only the C-level people's.`,
      );
    }
    const rules = run.rules as unknown as PayrollRules;
    const law = runLawRates(run);
    // the permission hours a month (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day"): the most
    // a line's typed permission hours may be
    const setup = await this.prisma.leaveSettings.findUnique({ where: { id: 1 }, select: { permissionHoursPerMonth: true } });
    const permissionMonth = setup ? setup.permissionHoursPerMonth.toNumber() : PERMISSION_RULE_DEFAULTS.hoursPerMonth;

    const updates: { line: LineRow; data: Prisma.PayrollLineUpdateInput; diff: Record<string, unknown> }[] = [];
    for (const change of dto.lines) {
      const line = lines.get(change.id)!;
      const was = savedInputs(line.inputs);
      // the expected hours are worked out from the shift, never typed (owner, 20 October 2026: "expected hours to be
      // locked based on shifts and attendance data"): the DTO refuses any sent, and a draft's line never keeps any
      const inputs: PayrollInputs = { ...was, ...(change.inputs ? sent(change.inputs) : {}), expectedHours: null };
      // paid leave is taken on days the month pays (owner, 17 October 2026), and unpaid leave too (18 October 2026)
      const lineTerms = line.terms as unknown as PayrollTerms;
      const paidDays = lineTerms.paidDays;
      if (inputs.leaveDays !== null && inputs.leaveDays > paidDays) {
        throw new BadRequestException(`${line.nameEn}: the leave days (${inputs.leaveDays}) can't be more than the ${paidDays} days paid this month.`);
      }
      const leave = leaveDaysOf(lineTerms, inputs);
      if ((leave.leaveDays ?? 0) + (leave.unpaidLeaveDays ?? 0) > paidDays) {
        throw new BadRequestException(
          `${line.nameEn}: the leave days (${leave.leaveDays ?? 0}) and the unpaid leave days (${leave.unpaidLeaveDays ?? 0}) can't be more than the ${paidDays} days paid this month together.`,
        );
      }
      // permission counts as worked within the month's allowance only (19 October 2026)
      if (typeof inputs.permissionHours === 'number' && inputs.permissionHours > permissionMonth) {
        throw new BadRequestException(
          `${line.nameEn}: the permission hours (${formatHours(inputs.permissionHours)}) can't be more than the ${permissionHoursText(permissionMonth)} a month Leave Setup allows.`,
        );
      }
      const diff: Record<string, unknown> = changes(was as unknown as Record<string, unknown>, inputs as unknown as Record<string, unknown>);
      // what an attendance import filled isn't typed over (owner, 19 October 2026: "imported data shouldn't be
      // editable"): the month is imported again, or the import undone on its review, to change it; sent as it is, it is
      // no change
      const mark = line.attendanceImport as unknown as AttendanceImportMark | null;
      const locked = importedInputsChanged(mark, Object.keys(diff));
      if (locked.length) throw new ConflictException(importedInputRefusal(locked[0], line.nameEn, mark!.at, mark!.source));
      for (const key of MONEY_INPUTS) if (key in diff) diff[key] = 'changed';
      Object.assign(diff, changes({ onHold: line.onHold, comments: line.comments }, { onHold: change.onHold, comments: change.comments }));
      if (!Object.keys(diff).length) continue;
      updates.push({
        line,
        data: {
          inputs: json(inputs),
          onHold: change.onHold,
          comments: change.comments,
          ...worked(line.terms as unknown as PayrollTerms, inputs, rules, law),
        },
        diff,
      });
    }

    await this.prisma.$transaction(updates.map((u) => this.prisma.payrollLine.update({ where: { id: u.line.id }, data: u.data })));
    for (const u of updates) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: LINE, entityId: u.line.id, diff: { runId: id, month, employeeCode: u.line.employeeCode, ...u.diff } });
    }
    return this.get(id, user);
  }

  /** HR sends a draft to the CEO. */
  async submit(id: string, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    this.assertStatus(run, 'draft', 'sent to the CEO');
    if (!run.lines.length) throw new ConflictException(`Nobody is on the ${monthName(monthOf(run))} payroll. Refresh it once the contracts are signed.`);
    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'pending_ceo', submittedAt: new Date(), returnedReason: null } });
    await this.statusChanged(run, 'pending_ceo', 'submit', user);
    return this.get(id, user);
  }

  /** The CEO sends it back to HR, saying why; HR changes it and sends it again. */
  async returnToHr(id: string, dto: ReturnPayrollDto, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    this.assertStatus(run, 'pending_ceo', 'returned');
    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'draft', returnedReason: dto.reason } });
    await this.statusChanged(run, 'draft', 'return', user, { reason: dto.reason });
    // a draft again: any bonus or penalty days, commission or settlements still typed on its grid (sent before they
    // moved, 17 October 2026) become additions and deductions, and any expected hours typed (sent before they were
    // locked, 20 October 2026: "expected hours to be locked based on shifts and attendance data") are cleared, the
    // shift's taken instead
    await this.gridInputs.convert(id);
    await this.expectedHours.clear(id);
    return this.get(id, user);
  }

  /**
   * The CEO waives a line's attendance deduction, or takes the waiver back (owner, 17 October 2026: "if there is an
   * attendance deduction, allow the CEO to wave the deduction by ticking a box"): only while the run is with the CEO,
   * and only on a line with an attendance cut to waive. The line is worked out again at once, its no-show and KPI cuts
   * as they were; the approval takes it as it is, and nothing changes it after. The audit log has the waiver's from and
   * to, the amount only as changed.
   */
  async waiveAttendance(id: string, lineId: string, dto: AttendanceWaiverDto, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    const month = monthOf(run);
    if (run.status !== 'pending_ceo') {
      throw new ConflictException(`The ${monthName(month)} payroll ${STATUS_TEXT[run.status as PayrollStatus]}: an attendance deduction is waived only while the run is with the CEO.`);
    }
    const line = run.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException('This line is not on this payroll. Reload it and try again.');
    const rules = run.rules as unknown as PayrollRules;
    const law = runLawRates(run);
    const terms = line.terms as unknown as PayrollTerms;
    // the inputs as saved, those of a line sent before 17 October 2026 included, so it is worked out as it was
    const saved = { ...EMPTY_PAYROLL_INPUTS, ...(line.inputs as object) } as PayrollInputs;
    const was = saved.attendanceWaived === true;
    if (dto.waived === was) return this.get(id, user);
    if (dto.waived && !(payrollLine(terms, { ...saved, attendanceWaived: false }, rules, law).attendanceCut > 0)) {
      throw new ConflictException(`${line.nameEn} has no attendance deduction to waive this month.`);
    }
    const inputs: PayrollInputs = { ...saved, attendanceWaived: dto.waived };
    await this.prisma.payrollLine.update({ where: { id: line.id }, data: { inputs: json(inputs), ...worked(terms, inputs, rules, law) } });
    await this.audit.record({
      userId: user.id,
      action: dto.waived ? 'waive_attendance' : 'restore_attendance',
      entityType: LINE,
      entityId: line.id,
      // the amount only as changed, as for a salary
      diff: { runId: id, month, employeeCode: line.employeeCode, attendanceWaived: { from: was, to: dto.waived }, attendanceCut: 'changed' },
    });
    return this.get(id, user);
  }

  /**
   * The CEO approves it (the CEO only: owner's decision, 16 October 2026). It is locked from now on, and each line's
   * bank details are copied, so the bank files pay what was approved.
   */
  async approve(id: string, user: SessionUser): Promise<PayrollRunView> {
    const run = await this.row(id);
    this.assertStatus(run, 'pending_ceo', 'approved');
    const banks = await this.banks(run.lines.map((l) => l.employeeId));
    const { applied, settled } = await this.prisma.$transaction(async (tx) => {
      for (const l of run.lines) {
        const b = banks.get(l.employeeId);
        await tx.payrollLine.update({
          where: { id: l.id },
          // a bank not on the EG-ACH list is kept as typed, so the problem still reads as such
          data: { bankShort: b?.bank ? (bankNamed(b.bank)?.short ?? b.bank) : null, accountNo: b?.accountNo ?? null, iban: b?.iban ?? null, holderName: b?.holderName ?? null },
        });
      }
      await tx.payrollRun.update({ where: { id }, data: { status: 'approved', approvedById: user.id, approvedAt: new Date() } });
      // the month's additions and deductions applied to their lines (owner, 17 October 2026)
      return this.adjustments.applyRun(id, tx);
    });
    await this.statusChanged(run, 'approved', 'approve', user, applied.length ? { adjustmentsApplied: applied.length, ...(settled.length && { advancesSettled: settled }) } : {});
    await this.adjustments.recordApplied(id, monthOf(run), applied, user);
    return this.get(id, user);
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
    return this.get(id, user);
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

  /** The payroll register, whatever the status: without the C-level people's lines hidden from the caller, as the run. */
  async register(id: string, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const view = await this.get(id, user);
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
    // without the C-level people's lines for anyone but the CEO and a Super Admin (owner, 19 October 2026), who download
    // the files complete
    const hidden = new Set(await this.confidential.hiddenFrom(user));
    const lines = run.lines
      .filter((l) => !hidden.has(l.employeeId))
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

  /**
   * Who is on the month's run, and who is left out, as the employments and contracts are now; the expected hours with
   * the month's holidays as they are now (a holiday added since the run was made counts once it is refreshed).
   */
  private async roster(month: string, rules: PayrollRules, law: LawRates) {
    const from = toDateOnly(firstDay(month));
    const to = toDateOnly(lastDay(month));
    const [rows, holidays, leaveSetup] = await Promise.all([
      this.prisma.employment.findMany({
        where: { joinDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] },
        select: rosterSelect(from, to),
      }),
      this.holidays.datesBetween(firstDay(month), lastDay(month)),
      // the permission hours a month (19 October 2026): the most a line's permission counts
      this.prisma.leaveSettings.findUnique({ where: { id: 1 }, select: { permissionHoursPerMonth: true } }),
    ]);
    return roster(month, rows.map(rosterEmployment), rules, holidays, law, leaveSetup?.permissionHoursPerMonth.toNumber());
  }

  /** The employees' bank details as they are now, by employee. Read in full here, never sent. */
  private async banks(employeeIds: string[]): Promise<Map<string, BankDetails>> {
    const rows = await this.prisma.employeeBank.findMany({ where: { employeeId: { in: employeeIds } } });
    return new Map(rows.map((b) => [b.employeeId, cleanBankDetails({ bank: b.bankName, accountNo: b.accountNo, iban: b.iban, holderName: b.holderName })]));
  }

  private async view(run: RunRow, user: SessionUser): Promise<PayrollRunView> {
    const [banks, approver, notOnRun, settings, confidential] = await Promise.all([
      isApproved(run.status) ? new Map<string, BankDetails>() : this.banks(run.lines.map((l) => l.employeeId)),
      run.approvedBy ? this.prisma.employee.findUnique({ where: { workEmail: run.approvedBy.email.toLowerCase() }, select: { fullNameEn: true } }) : null,
      // the month's pending additions and deductions no line takes (owner, 17 October 2026)
      this.prisma.payrollAdjustment.groupBy({
        by: ['employeeId'],
        where: { month: run.month, status: 'pending', employeeId: { notIn: run.lines.map((l) => l.employeeId) } },
        _count: { _all: true },
      }),
      // the limit on a month's installments the lines warn past (18 October 2026)
      this.settings.row(),
      // the C-level people, and those hidden from the caller (19 October 2026)
      this.confidential.view(user),
    ]);
    const people = notOnRun.length
      ? await this.prisma.employee.findMany({ where: { id: { in: notOnRun.map((g) => g.employeeId) } }, select: { id: true, employeeCode: true, fullNameEn: true } })
      : [];
    const counts = new Map(notOnRun.map((g) => [g.employeeId, g._count._all]));
    const adjustmentsNotOnRun = people
      .map((p) => ({ employeeId: p.id, employeeCode: p.employeeCode, name: p.fullNameEn, count: counts.get(p.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return runView(run, {
      banks,
      approvedByName: approver?.fullNameEn ?? null,
      adjustmentsNotOnRun,
      installmentLimitPercent: settings.installmentLimitPercent.toNumber(),
      confidential: { all: confidential.all, hidden: confidential.hidden, changes: (line) => changesPayrollLine(user, line) },
    });
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
