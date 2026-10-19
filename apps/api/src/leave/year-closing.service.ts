import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  adjustmentTaxed,
  annualMinimumFlags,
  annualUnused,
  carriedAfterClosing,
  LEAVE_PAYOUT_TYPE,
  leavePayAmount,
  leavePayoutMonth,
  settleByAge,
  unusedByYear,
  yearClosingProblems,
  type AdjustmentStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { RunAdjustmentsService } from '../payroll/adjustments/run-adjustments.service.js';
import { ADJUSTMENT } from '../payroll/adjustments/views.js';
import { monthName } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LeaveBalancesService, type LeaveEmployment, type YearFigures } from './leave-balances.service.js';
import type { CloseYearDto } from './leave.dto.js';
import { CLOSING_ENTITY, placeOf } from './views.js';

/** One employee's year at its closing, as GET /leave/year-closing/:year sends it. */
export interface YearClosingRow {
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  employmentId: string;
  /** The days unused at the year's end: earned, carried in and adjusted, less what was approved. */
  unused: number;
  /** Those days by the year each was earned in, the oldest used first. */
  carriedByYear: Record<string, number>;
  /** Those carried for three years (Art. 125): paid now. */
  mustSettle: number;
  /** The decision: as saved once closed; before then, what must be settled paid and the rest carried. */
  carry: number;
  pay: number;
  /** A day's pay: the gross in force at the year's end (today, for this year) ÷ the payroll's day divisor. */
  dayRate: number;
  payAmount: number;
  /** What the law asks for that can't be enforced (Art. 125: at least 15 days a year, 6 of them in a row). */
  flags: string[];
  /** Once closed with days paid: the Unused leave paid addition, as Additions / Deductions has it now. */
  payout: { adjustmentId: string; month: string; status: AdjustmentStatus } | null;
}

export interface YearClosingView {
  year: number;
  closed: boolean;
  closedAt: string | null;
  rows: YearClosingRow[];
  /**
   * The C-level people left out for the caller (owner, 19 October 2026: "make C level Employees details not visible to
   * HR"): HR closing the year gives them the default decision (what must be settled paid, the rest carried).
   */
  confidentialExcluded: number;
}

/** Why a C-level person's year isn't closed by HR's default: their figures need a decision HR can't see to make. */
const DEFAULT_REFUSED = "A C-level person's year can't be closed with the default decision (what must be settled paid, the rest carried). Ask a user with HR and Super Admin to close it.";

const tenth = (n: number) => Math.round(n * 10) / 10 + 0;

// Year Closing (owner, 18 October 2026, on unused annual leave: "make it with decision with the year closing"): at a
// year's end HR decides, for each employee employed then, how many of their unused days of annual leave carry into the
// next year and how many are paid. The law forbids losing leave (Labour Law 14/2025 Art. 125: "لا يجوز للعامل النزول عن
// إجازته … ويلتزم صاحب العمل بتسوية رصيد الإجازات، أو الأجر المقابل له كل ثلاث سنوات على الأكثر"): what is carried and
// what is paid add up to what is unused, and the days carried for three years are paid now (packages/shared
// yearClosingProblems, settleByAge). Closing the year: the next year's carried in is what is carried (by the year each
// day was earned in, the oldest paid first), and what is paid is a taxed Unused leave paid addition at a day of the
// gross, in January of the next year or the first month after it whose run isn't approved or paid. Not while requests
// from the annual balance of the year are still being decided; a closed year takes no more leave from it. HR may reopen
// it until its payouts are applied to a payroll (the pending ones are cancelled). Those who left during the year are paid
// with their final settlement (UnsettledService). HR closes and reopens; HR and the CEO see it. The C-level people's rows
// (owner, 19 October 2026: "make C level Employees details not visible to HR") only for the CEO and a Super Admin: HR
// closing the year gives them the default decision, the days that must be settled paid and the rest carried.
@Injectable()
export class YearClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly balances: LeaveBalancesService,
    private readonly runs: RunAdjustmentsService,
    private readonly confidential: ConfidentialService,
  ) {}

  async view(year: number, user: SessionUser): Promise<YearClosingView> {
    const closing = await this.prisma.leaveYearClosing.findUnique({ where: { year } });
    const [all, hidden] = await Promise.all([this.rows(year), this.confidential.hiddenFrom(user)]);
    const rows = all.filter((r) => !hidden.includes(r.employee.id));
    return { year, closed: !!closing, closedAt: closing?.closedAt.toISOString() ?? null, rows, confidentialExcluded: all.length - rows.length };
  }

  /** HR closes the year with every employee's decision. */
  async close(year: number, dto: CloseYearDto, user: SessionUser): Promise<YearClosingView> {
    await this.assertMayChange(year, 'closed');
    if (await this.prisma.leaveYearClosing.findUnique({ where: { year } })) throw new ConflictException(`${year}'s leave is closed already. Reopen it to change it.`);
    const pending = await this.prisma.leaveRequest.count({
      where: { status: { in: ['with_manager', 'with_hr'] }, type: { balance: { in: ['annual', 'from_annual'] } }, startDate: { gte: toDateOnly(`${year}-01-01`), lte: toDateOnly(`${year}-12-31`) } },
    });
    if (pending) {
      throw new ConflictException(`${pending} request${pending === 1 ? ' is' : 's are'} for leave from ${year}'s annual balance still being decided: decide ${pending === 1 ? 'it' : 'them'} first.`);
    }
    const hidden = await this.confidential.hiddenFrom(user);
    const rows = await this.rows(year);
    // the rows the caller decides: a C-level person's is the CEO's and a Super Admin's to see (19 October 2026)
    const decided = rows.filter((r) => !hidden.includes(r.employee.id));
    const byEmployee = new Map(decided.map((r) => [r.employee.id, r]));
    const sent = new Map<string, { carry: number; pay: number }>();
    const problems: string[] = [];
    for (const r of dto.rows) {
      if (!byEmployee.has(r.employeeId)) problems.push('One of the rows is not an employee employed at the end of the year. Reload the page and try again.');
      else if (sent.has(r.employeeId)) problems.push(`${byEmployee.get(r.employeeId)!.employee.fullNameEn} is sent twice: send each employee once.`);
      sent.set(r.employeeId, { carry: r.carry, pay: r.pay });
    }
    const missing = decided.filter((r) => !sent.has(r.employee.id)).map((r) => r.employee.fullNameEn);
    if (missing.length) problems.push(`Decide every employee: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`);
    if (problems.length) throw new BadRequestException([...new Set(problems)]);
    // the C-level people hidden from the caller: the default decision, what must be settled paid and the rest carried
    for (const r of rows) {
      if (byEmployee.has(r.employee.id)) continue;
      if (yearClosingProblems(r.unused, r.carry, r.pay, r.mustSettle).length || (r.pay > 0 && !(r.dayRate > 0))) throw new ConflictException(DEFAULT_REFUSED);
      sent.set(r.employee.id, { carry: r.carry, pay: r.pay });
    }
    for (const r of decided) {
      const d = sent.get(r.employee.id)!;
      for (const p of yearClosingProblems(r.unused, d.carry, d.pay, r.mustSettle)) problems.push(`${r.employee.fullNameEn}: ${p}`);
      if (d.pay > 0 && !(r.dayRate > 0)) problems.push(`${r.employee.fullNameEn}: there is no signed contract to work a day's pay out from, so the days can't be paid. Carry them instead.`);
    }
    if (problems.length) throw new BadRequestException(problems);

    const at = new Date();
    const { payMonth, paid } = await this.prisma.$transaction(async (tx) => {
      await tx.leaveYearClosing.create({ data: { year, closedAt: at, closedById: user.id } });
      const closed = await tx.payrollRun.findMany({ where: { status: { in: ['approved', 'paid'] } }, select: { month: true } });
      const payMonth = leavePayoutMonth(year, closed.map((r) => fromDateOnly(r.month)));
      const paid: { adjustmentId: string; employeeId: string; employeeCode: string; days: number }[] = [];
      for (const r of rows) {
        const { carry, pay } = sent.get(r.employee.id)!;
        let adjustmentId: string | null = null;
        if (pay > 0) {
          const adjustment = await tx.payrollAdjustment.create({
            data: {
              employeeId: r.employee.id,
              month: toDateOnly(payMonth),
              kind: 'addition',
              type: LEAVE_PAYOUT_TYPE,
              // taxed, as pay (packages/shared payroll-adjustments.ts)
              taxed: adjustmentTaxed('addition', LEAVE_PAYOUT_TYPE, null) ?? true,
              amount: leavePayAmount(pay, r.dayRate),
              reason: `Unused leave paid: ${pay} ${pay === 1 ? 'day' : 'days'} of ${year}`,
              createdById: user.id,
            },
            select: { id: true, employee: { select: { employeeCode: true } } },
          });
          adjustmentId = adjustment.id;
          paid.push({ adjustmentId, employeeId: r.employee.id, employeeCode: adjustment.employee.employeeCode, days: pay });
        }
        const closing = { closedAt: at, closedById: user.id, closedOn: 'year_closing', unused: r.unused, carriedOut: carry, paidOut: pay, dayRate: r.dayRate, payoutAdjustmentId: adjustmentId };
        await tx.leaveBalanceYear.upsert({
          where: { employmentId_year: { employmentId: r.employmentId, year } },
          create: { employeeId: r.employee.id, employmentId: r.employmentId, year, ...closing },
          update: closing,
        });
        const carried = { carriedIn: carry, carriedInByYear: carriedAfterClosing(r.carriedByYear, pay) as Prisma.InputJsonValue };
        await tx.leaveBalanceYear.upsert({
          where: { employmentId_year: { employmentId: r.employmentId, year: year + 1 } },
          create: { employeeId: r.employee.id, employmentId: r.employmentId, year: year + 1, ...carried },
          update: carried,
        });
      }
      return { payMonth, paid };
    });

    await this.audit.record({
      userId: user.id,
      action: 'close',
      // by its year in the entry, as the audit log's ids are records' ids
      entityType: CLOSING_ENTITY,
      diff: {
        year,
        employees: rows.length,
        carried: tenth(rows.reduce((n, r) => n + sent.get(r.employee.id)!.carry, 0)),
        paid: tenth(rows.reduce((n, r) => n + sent.get(r.employee.id)!.pay, 0)),
        ...(paid.length && { payMonth: payMonth.slice(0, 7) }),
      },
    });
    for (const p of paid) {
      await this.audit.record({
        userId: user.id,
        action: 'create',
        entityType: ADJUSTMENT,
        entityId: p.adjustmentId,
        diff: { employeeCode: p.employeeCode, month: payMonth.slice(0, 7), kind: 'addition', type: LEAVE_PAYOUT_TYPE, taxed: true, amount: 'set', days: p.days, leaveYear: year },
      });
    }
    if (paid.length) await this.runs.syncDrafts([payMonth.slice(0, 7)], paid.map((p) => p.employeeId), user);
    return this.view(year, user);
  }

  /** HR reopens a closed year until its payouts are applied: the pending ones cancelled, the next year's carried in undone. */
  async reopen(year: number, user: SessionUser): Promise<YearClosingView> {
    if (!(await this.prisma.leaveYearClosing.findUnique({ where: { year } }))) throw new ConflictException(`${year}'s leave isn't closed.`);
    await this.assertMayChange(year, 'reopened');
    const closedRows = await this.prisma.leaveBalanceYear.findMany({
      where: { year, closedOn: 'year_closing' },
      select: { id: true, employmentId: true, payoutAdjustment: { select: { id: true, status: true, month: true, employeeId: true } } },
    });
    const payouts = closedRows.flatMap((r) => (r.payoutAdjustment ? [r.payoutAdjustment] : []));
    const applied = payouts.filter((p) => p.status === 'applied');
    if (applied.length) {
      const month = monthName(fromDateOnly(applied[0].month).slice(0, 7));
      throw new ConflictException(`${applied.length} of ${year}'s payouts ${applied.length === 1 ? 'was' : 'were'} paid with the ${month} payroll, so the year can't be reopened.`);
    }
    const pending = payouts.filter((p) => p.status === 'pending');
    const at = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (pending.length) {
        await tx.payrollAdjustment.updateMany({ where: { id: { in: pending.map((p) => p.id) }, status: 'pending' }, data: { status: 'cancelled', cancelledById: user.id, cancelledAt: at } });
      }
      await tx.leaveBalanceYear.updateMany({
        where: { id: { in: closedRows.map((r) => r.id) } },
        data: { closedAt: null, closedById: null, closedOn: null, unused: null, carriedOut: null, paidOut: null, dayRate: null, payoutAdjustmentId: null },
      });
      await tx.leaveBalanceYear.updateMany({ where: { year: year + 1, employmentId: { in: closedRows.map((r) => r.employmentId) } }, data: { carriedIn: 0, carriedInByYear: {} } });
      await tx.leaveYearClosing.delete({ where: { year } });
    });
    await this.audit.record({ userId: user.id, action: 'reopen', entityType: CLOSING_ENTITY, diff: { year, payoutsCancelled: pending.length } });
    for (const p of pending) {
      await this.audit.record({ userId: user.id, action: 'cancel', entityType: ADJUSTMENT, entityId: p.id, diff: { month: fromDateOnly(p.month).slice(0, 7), status: { from: 'pending', to: 'cancelled' }, leaveYear: year } });
    }
    if (pending.length) await this.runs.syncDrafts([...new Set(pending.map((p) => fromDateOnly(p.month).slice(0, 7)))], pending.map((p) => p.employeeId), user);
    return this.view(year, user);
  }

  // ---------- helpers ----------

  /** Not a year to come, nor one before a closed year (the later one's carried in stands on it). */
  private async assertMayChange(year: number, doing: string): Promise<void> {
    const current = Number(todayInCairo().slice(0, 4));
    if (year > current) throw new BadRequestException([`${year} hasn't started yet: a year is closed from its last month on.`]);
    if (await this.prisma.leaveYearClosing.findUnique({ where: { year: year + 1 } })) {
      throw new ConflictException(`${year + 1}'s leave is closed, and it carried in from ${year}: reopen ${year + 1} first, so ${year} can be ${doing}.`);
    }
  }

  /** Every employee employed at the year's end, with their year at its closing. */
  private async rows(year: number): Promise<YearClosingRow[]> {
    const today = todayInCairo();
    const end = `${year}-12-31`;
    const employments = await this.balances.employedAtYearEnd(year);
    const [figures, rates, rules, places] = await Promise.all([
      this.balances.yearFigures(employments.map((employment) => ({ employment, year })), end < today ? end : today),
      this.balances.dayRates(employments.map((e) => e.id), end < today ? end : today),
      this.balances.rules(),
      this.places(employments),
    ]);
    const adjustments = await this.payouts([...figures.values()].flatMap((f) => (f.closed?.payoutAdjustmentId ? [f.closed.payoutAdjustmentId] : [])));
    return employments.map((e) => {
      const f = figures.get(`${e.id}:${year}`)!;
      const byYear = this.byYear(f, year);
      const unused = f.closed ? f.closed.unused : annualUnused(f);
      const mustSettle = Math.min(Math.max(0, unused), settleByAge(byYear, year, rules.settleWithinYears));
      const carry = f.closed ? f.closed.carriedOut : unused < 0 ? unused : tenth(unused - mustSettle);
      const pay = f.closed ? f.closed.paidOut : unused < 0 ? 0 : mustSettle;
      const dayRate = f.closed?.dayRate ?? rates.get(e.id) ?? 0;
      const payout = f.closed?.payoutAdjustmentId ? (adjustments.get(f.closed.payoutAdjustmentId) ?? null) : null;
      return {
        employee: { id: e.employeeId, fullNameEn: e.employee.fullNameEn, ...(places.get(e.id) ?? { department: null, team: null }) },
        employmentId: e.id,
        unused,
        carriedByYear: byYear,
        mustSettle,
        carry,
        pay,
        dayRate,
        payAmount: leavePayAmount(pay, dayRate),
        flags: annualMinimumFlags(f.entitlement, f.approved),
        payout,
      };
    });
  }

  /**
   * A year's unused days by the year each was earned in: the days carried in by their years (a carried in without them
   * counts as the year before's), then the year's own, the days approved taken from the oldest first.
   */
  private byYear(f: YearFigures, year: number): Record<string, number> {
    const known = Object.values(f.carriedInByYear).reduce((n, d) => n + d, 0);
    const carried = Math.round(known * 10) === Math.round(f.carriedIn * 10) ? f.carriedInByYear : { [String(year - 1)]: f.carriedIn };
    return unusedByYear(carried, year, f.entitlement + f.adjustments, f.taken + f.booked);
  }

  private async places(employments: readonly LeaveEmployment[]) {
    const rows = await this.prisma.employment.findMany({
      where: { id: { in: employments.map((e) => e.id) } },
      select: { id: true, department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } },
    });
    return new Map(rows.map((r) => [r.id, placeOf(r.department)]));
  }

  private async payouts(ids: string[]) {
    if (!ids.length) return new Map<string, YearClosingRow['payout']>();
    const rows = await this.prisma.payrollAdjustment.findMany({ where: { id: { in: ids } }, select: { id: true, month: true, status: true } });
    return new Map(rows.map((r) => [r.id, { adjustmentId: r.id, month: fromDateOnly(r.month).slice(0, 7), status: r.status as AdjustmentStatus }]));
  }
}
