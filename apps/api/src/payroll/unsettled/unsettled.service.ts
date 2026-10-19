import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { daysBetween, END_REASON_LABELS, sumAmounts, type AdvanceKind, type EndReason, type HoldReleaseMethod, type PayrollStatus } from '@trendlix/shared';
import { AuditService } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { addDays, fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ConfidentialService } from '../../employees/confidential.service.js';
import { LeaveSettlementService, type UnusedLeaveView } from '../../leave/leave-settlement.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdvancesService } from '../adjustments/advances.service.js';
import { placeName, refOf, userNames, type UserRef } from '../adjustments/people.js';
import { ADVANCE_INCLUDE, balanceOf, personOf, type AdvanceView, type PersonRef } from '../adjustments/views.js';
import { firstDay, monthName } from '../months.js';
import { STATUS_TEXT } from '../status.js';
import { isApproved, monthOf } from '../views.js';
import type { PaidOutDto, ReopenFinalDto, SettleFinalDto } from './unsettled.dto.js';

const SETTLEMENT = 'final_settlement';
const LINE = 'payroll_line';
const CLEARANCE_SLOT = 'clearance_dues';
/** How long a final settlement stays under Recently Settled, where HR can reopen it. */
export const RECENTLY_SETTLED_DAYS = 90;

/** A run not yet marked paid: a draft, with the CEO, or approved. */
export interface RunNotPaid {
  id: string;
  month: string;
  status: PayrollStatus;
  employees: number;
  /** Lines on hold on it. */
  held: number;
  /** What it transfers, the lines on hold included, as the runs list shows it. */
  transfer: number;
  net: number;
  companyCost: number;
  createdAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
}

/** A line held on an approved or paid run and not recorded as paid out since. */
export interface HeldLine {
  lineId: string;
  runId: string;
  month: string;
  runStatus: PayrollStatus;
  employee: PersonRef;
  department: string | null;
  /** What the bank would have paid: the line's transfer. */
  amount: number;
  net: number;
  comments: string | null;
}

export interface ClearanceDocument {
  id: string;
  fileName: string;
  generatedAt: Date;
  status: string;
}

/** An ended employment's final settlement: open from its end date until HR marks it settled. */
export interface FinalSettlementView {
  employmentId: string;
  employee: PersonRef;
  department: string | null;
  jobTitle: string | null;
  joinDate: string;
  endDate: string;
  endReason: string | null;
  /** The reason in words: the ending rule's name when it was ended through one, else the end reason's. */
  reasonText: string | null;
  status: 'open' | 'settled';
  /** Open: days since the end date. */
  daysOpen: number;
  /** Marked settled, and reopened since. */
  reopened: boolean;
  settledOn: string | null;
  amountPaid: number | null;
  note: string | null;
  document: ClearanceDocument | null;
  settledBy: UserRef | null;
  settledAt: Date | null;
  /** The employment's "Clearance and dues" documents, newest first: one may be linked when settling. */
  clearances: ClearanceDocument[];
  /**
   * The employee's advances and loans still open, with what is outstanding (owner, 18 October 2026, on leaving before
   * it is paid back: "taken from the final settlement, unless waived"): to deduct from the final settlement, or waive.
   */
  outstanding: { advanceId: string; kind: AdvanceKind; reason: string; outstanding: number }[];
  /**
   * The annual leave unused on the last working day, to pay with the final settlement (Labour Law 14/2025 Art. 125:
   * "فإذا انتهت علاقة العمل قبل استنفاد العامل رصيد إجازته السنوية استحق الأجر المقابل لهذا الرصيد"; owner, 18 October
   * 2026): its days, the day rate and the amount, and once HR recorded it paid the Unused leave paid addition. Null when
   * it can't be told (no employment ended).
   */
  unusedLeave: UnusedLeaveView | null;
}

export interface UnsettledView {
  generatedAt: string;
  today: string;
  runs: { count: number; transfer: number; rows: RunNotPaid[] };
  held: { count: number; amount: number; rows: HeldLine[] };
  settlements: { count: number; rows: FinalSettlementView[]; recentlySettled: FinalSettlementView[] };
  advances: { count: number; amount: number; outstanding: number; rows: AdvanceView[] };
  /** The C-level people left out for the caller (owner, 19 October 2026): their lines, settlements and advances, sums too. */
  confidentialExcluded: number;
}

/** What a final settlement is shown with. */
const SETTLEMENT_SELECT = {
  id: true,
  joinDate: true,
  endDate: true,
  endReason: true,
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
  jobTitle: { select: { titleEn: true } },
  endings: { where: { status: 'completed' }, orderBy: { completedAt: 'desc' }, take: 1, select: { rule: { select: { label: true } } } },
  documents: {
    where: { slotKey: CLEARANCE_SLOT },
    orderBy: { generatedAt: 'desc' },
    select: { id: true, fileName: true, generatedAt: true, status: true },
  },
  finalSettlement: {
    include: { document: { select: { id: true, fileName: true, generatedAt: true, status: true } }, settledBy: { select: { id: true, email: true } } },
  },
} satisfies Prisma.EmploymentSelect;

type SettlementRow = Prisma.EmploymentGetPayload<{ select: typeof SETTLEMENT_SELECT }>;

// Unsettled (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Unsettled - Additions /
// Deductions"; asked, the owner chose what it lists): the runs not yet paid (a draft, with the CEO, approved but not
// marked paid); the lines on hold, held on an approved or paid run and not paid out since; the final settlements of
// people who left, open from their employment's end date until HR marks them settled; and the advances and loans still
// being recovered. A held line counts as paid out once HR records it (the day, how, a note): a run never pays a line
// held on it, and nothing else records that it was paid. HR, Finance and the CEO see it; HR settles, reopens and
// records payouts. Every change is in the audit log, the amounts only as set, as for a salary. A final settlement lists
// what is still outstanding of the employee's advances and loans (owner, 18 October 2026: "taken from the final
// settlement, unless waived"), which HR settles as deducted from it or waives (POST /payroll/advances/:id/settle).
// Without the C-level people (owner, 19 October 2026: "make C level Employees details not visible to HR") for anyone but
// the CEO and a Super Admin: their held lines, final settlements and advances, and their lines in the runs' sums.
@Injectable()
export class UnsettledService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly advances: AdvancesService,
    private readonly leave: LeaveSettlementService,
    private readonly confidential: ConfidentialService,
  ) {}

  async unsettled(user: SessionUser): Promise<UnsettledView> {
    const today = todayInCairo();
    const hidden = await this.confidential.hiddenFrom(user);
    const [runs, held, settlements, recentlySettled, advances, excluded] = await Promise.all([
      this.runsNotPaid(hidden),
      this.heldLines(hidden),
      this.openSettlements(today, hidden),
      this.recentlySettled(today, hidden),
      this.advances.list({ status: 'open' }, hidden),
      this.excluded(hidden),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      today,
      runs: { count: runs.length, transfer: sumAmounts(runs.map((r) => r.transfer)), rows: runs },
      held: { count: held.length, amount: sumAmounts(held.map((h) => h.amount)), rows: held },
      settlements: { count: settlements.length, rows: settlements, recentlySettled },
      advances: {
        count: advances.length,
        amount: sumAmounts(advances.map((a) => a.amount)),
        outstanding: sumAmounts(advances.map((a) => a.outstanding)),
        rows: advances,
      },
      confidentialExcluded: excluded,
    };
  }

  /** How many of `hidden` are on a run not paid, or have something unsettled: those the lists leave out. */
  private async excluded(hidden: readonly string[]): Promise<number> {
    if (!hidden.length) return 0;
    const ids = [...hidden];
    const rows = await this.prisma.employee.findMany({
      where: {
        id: { in: ids },
        OR: [
          { payrollLines: { some: { run: { status: { not: 'paid' } } } } },
          { payrollLines: { some: { onHold: true, transfer: { gt: 0 }, holdRelease: { is: null }, run: { status: { in: ['approved', 'paid'] } } } } },
          { employments: { some: { endDate: { not: null }, OR: [{ finalSettlement: { is: null } }, { finalSettlement: { is: { status: 'open' } } }] } } },
          { payrollAdvances: { some: { status: 'open' } } },
        ],
      },
      select: { id: true },
    });
    return rows.length;
  }

  /** The runs not marked paid, oldest month first, with their sums over their lines. */
  async runsNotPaid(hidden: readonly string[] = []): Promise<RunNotPaid[]> {
    const runs = await this.prisma.payrollRun.findMany({ where: { status: { not: 'paid' } }, orderBy: { month: 'asc' } });
    if (!runs.length) return [];
    const ids = runs.map((r) => r.id);
    const shown = hidden.length ? { employeeId: { notIn: [...hidden] } } : {};
    const [sums, holds] = await Promise.all([
      this.prisma.payrollLine.groupBy({ by: ['runId'], where: { runId: { in: ids }, ...shown }, _count: { _all: true }, _sum: { transfer: true, net: true, companyCost: true } }),
      this.prisma.payrollLine.groupBy({ by: ['runId'], where: { runId: { in: ids }, onHold: true, ...shown }, _count: { _all: true } }),
    ]);
    const byRun = new Map(sums.map((s) => [s.runId, s]));
    const heldBy = new Map(holds.map((h) => [h.runId, h._count._all]));
    return runs.map((r) => {
      const s = byRun.get(r.id);
      return {
        id: r.id,
        month: monthOf(r),
        status: r.status as PayrollStatus,
        employees: s?._count._all ?? 0,
        held: heldBy.get(r.id) ?? 0,
        transfer: s?._sum.transfer?.toNumber() ?? 0,
        net: s?._sum.net?.toNumber() ?? 0,
        companyCost: s?._sum.companyCost?.toNumber() ?? 0,
        createdAt: r.createdAt,
        submittedAt: r.submittedAt,
        approvedAt: r.approvedAt,
      };
    });
  }

  /** Lines held on an approved or paid run with something to transfer, not recorded as paid out: oldest month first. */
  async heldLines(hidden: readonly string[] = []): Promise<HeldLine[]> {
    const lines = await this.prisma.payrollLine.findMany({
      where: { onHold: true, transfer: { gt: 0 }, holdRelease: { is: null }, run: { status: { in: ['approved', 'paid'] } }, ...(hidden.length && { employeeId: { notIn: [...hidden] } }) },
      orderBy: [{ run: { month: 'asc' } }, { nameEn: 'asc' }],
      select: {
        id: true,
        runId: true,
        department: true,
        transfer: true,
        net: true,
        comments: true,
        employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
        run: { select: { month: true, status: true } },
      },
    });
    return lines.map((l) => ({
      lineId: l.id,
      runId: l.runId,
      month: monthOf(l.run),
      runStatus: l.run.status as PayrollStatus,
      employee: personOf(l.employee),
      department: l.department,
      amount: l.transfer.toNumber(),
      net: l.net.toNumber(),
      comments: l.comments,
    }));
  }

  /** The ended employments whose final settlement is open, the longest open first. */
  async openSettlements(today = todayInCairo(), hidden: readonly string[] = []): Promise<FinalSettlementView[]> {
    const rows = await this.prisma.employment.findMany({
      where: {
        endDate: { not: null, lte: toDateOnly(today) },
        OR: [{ finalSettlement: { is: null } }, { finalSettlement: { is: { status: 'open' } } }],
        ...(hidden.length && { employeeId: { notIn: [...hidden] } }),
      },
      orderBy: [{ endDate: 'asc' }, { employee: { fullNameEn: 'asc' } }],
      select: SETTLEMENT_SELECT,
    });
    return this.settlementViews(rows, today);
  }

  /** Those marked settled in the last RECENTLY_SETTLED_DAYS days, the latest first: HR can reopen one. */
  async recentlySettled(today = todayInCairo(), hidden: readonly string[] = []): Promise<FinalSettlementView[]> {
    const rows = await this.prisma.employment.findMany({
      where: {
        finalSettlement: { is: { status: 'settled', settledOn: { gte: toDateOnly(addDays(today, -RECENTLY_SETTLED_DAYS)) } } },
        ...(hidden.length && { employeeId: { notIn: [...hidden] } }),
      },
      orderBy: [{ finalSettlement: { settledOn: 'desc' } }, { employee: { fullNameEn: 'asc' } }],
      select: SETTLEMENT_SELECT,
    });
    return this.settlementViews(rows, today);
  }

  async settlement(employmentId: string): Promise<FinalSettlementView> {
    return (await this.settlementViews([await this.settlementRow(employmentId)], todayInCairo()))[0];
  }

  /**
   * HR records an ended employment's unused annual leave paid (owner, 18 October 2026): an Unused leave paid addition in
   * the final month, or the first after it still open (leave/leave-settlement.service.ts). Answers the final settlement.
   */
  async payUnusedLeave(employmentId: string, user: SessionUser): Promise<FinalSettlementView> {
    await this.settlementRow(employmentId);
    await this.leave.pay(employmentId, user);
    return this.settlement(employmentId);
  }

  /**
   * HR marks an ended employment's final settlement settled: from its end date on, the day not in the future nor before
   * the join date, the amount paid (0 or more), a note, and one of its "Clearance and dues" documents if HR links one.
   */
  async settle(employmentId: string, dto: SettleFinalDto, user: SessionUser): Promise<FinalSettlementView> {
    const row = await this.settlementRow(employmentId);
    const today = todayInCairo();
    const name = row.employee.fullNameEn;
    const endDate = fromDateOnly(row.endDate);
    if (!endDate) throw new ConflictException(`${name}'s employment hasn't ended, so there is no final settlement yet.`);
    if (endDate > today) throw new ConflictException(`${name}'s employment ends on ${shownDate(endDate)}: its final settlement opens then.`);
    if (row.finalSettlement?.status === 'settled') throw new ConflictException(`${name}'s final settlement is settled already.`);
    if (dto.settledOn > today) throw new BadRequestException("The day the final dues were settled can't be in the future.");
    const joined = fromDateOnly(row.joinDate);
    if (dto.settledOn < joined) throw new BadRequestException(`The final dues can't have been settled before ${name} joined, on ${shownDate(joined)}.`);
    const documentId = dto.documentId ?? null;
    if (documentId && !row.documents.some((d) => d.id === documentId)) {
      throw new BadRequestException(`Choose one of the clearance and dues documents generated for ${name}'s employment.`);
    }

    const data = { status: 'settled', settledOn: toDateOnly(dto.settledOn), amountPaid: dto.amountPaid, note: dto.note ?? null, documentId, settledById: user.id, settledAt: new Date() };
    await this.prisma.finalSettlement.upsert({ where: { employmentId }, create: { employmentId, ...data }, update: data });
    await this.audit.record({
      userId: user.id,
      action: 'settle',
      // by the employment, so its history stays together however often it is reopened
      entityType: SETTLEMENT,
      entityId: employmentId,
      diff: {
        employeeCode: row.employee.employeeCode,
        endDate,
        status: { from: 'open', to: 'settled' },
        settledOn: dto.settledOn,
        amountPaid: 'set',
        note: dto.note ?? null,
        ...(documentId && { documentId }),
      },
    });
    return this.settlement(employmentId);
  }

  /** HR reopens one marked settled, saying why: it is listed open again, what was recorded kept until it is settled again. */
  async reopen(employmentId: string, dto: ReopenFinalDto, user: SessionUser): Promise<FinalSettlementView> {
    const row = await this.settlementRow(employmentId);
    if (row.finalSettlement?.status !== 'settled') throw new ConflictException(`${row.employee.fullNameEn}'s final settlement is open already.`);
    await this.prisma.finalSettlement.update({ where: { employmentId }, data: { status: 'open' } });
    await this.audit.record({
      userId: user.id,
      action: 'reopen',
      entityType: SETTLEMENT,
      entityId: employmentId,
      diff: { employeeCode: row.employee.employeeCode, status: { from: 'settled', to: 'open' }, reason: dto.reason },
    });
    return this.settlement(employmentId);
  }

  /**
   * HR records a held line as paid out: held on an approved or paid run, with something to transfer, not recorded yet;
   * the day from the run's month on and not in the future, how, and a note.
   */
  async paidOut(lineId: string, dto: PaidOutDto, user: SessionUser): Promise<HeldLine & { paidOut: { paidOn: string; method: HoldReleaseMethod; note: string | null } }> {
    const line = await this.prisma.payrollLine.findUnique({
      where: { id: lineId },
      select: { id: true, onHold: true, transfer: true, employeeCode: true, nameEn: true, run: { select: { month: true, status: true } }, holdRelease: { select: { id: true } } },
    });
    if (!line) throw new NotFoundException('Payroll line not found.');
    const month = monthOf(line.run);
    if (!line.onHold) throw new ConflictException(`${line.nameEn} wasn't on hold in ${monthName(month)}: the run paid them.`);
    if (!isApproved(line.run.status)) {
      throw new ConflictException(`The ${monthName(month)} payroll ${STATUS_TEXT[line.run.status as PayrollStatus]}: a hold is final once the CEO approves the run.`);
    }
    if (line.transfer.toNumber() <= 0) throw new ConflictException(`Nothing was held for ${line.nameEn} in ${monthName(month)}: there was nothing to transfer.`);
    if (line.holdRelease) throw new ConflictException(`${line.nameEn}'s held pay for ${monthName(month)} is recorded as paid out already.`);
    if (dto.paidOn > todayInCairo()) throw new BadRequestException("The day the held pay was paid out can't be in the future.");
    if (dto.paidOn < firstDay(month)) throw new BadRequestException(`The ${monthName(month)} pay can't have been paid out before ${shownDate(firstDay(month))}.`);

    await this.prisma.payrollHoldRelease.create({ data: { lineId, paidOn: toDateOnly(dto.paidOn), method: dto.method, note: dto.note ?? null, recordedById: user.id } });
    await this.audit.record({
      userId: user.id,
      action: 'paid_out',
      entityType: LINE,
      entityId: lineId,
      diff: { month, employeeCode: line.employeeCode, paidOn: dto.paidOn, method: dto.method, note: dto.note ?? null },
    });
    const view = await this.prisma.payrollLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { id: true, runId: true, department: true, transfer: true, net: true, comments: true, employee: { select: { id: true, employeeCode: true, fullNameEn: true } }, run: { select: { month: true, status: true } } },
    });
    return {
      lineId,
      runId: view.runId,
      month,
      runStatus: view.run.status as PayrollStatus,
      employee: personOf(view.employee),
      department: view.department,
      amount: view.transfer.toNumber(),
      net: view.net.toNumber(),
      comments: view.comments,
      paidOut: { paidOn: dto.paidOn, method: dto.method, note: dto.note ?? null },
    };
  }

  // ---------- helpers ----------

  private async settlementRow(employmentId: string): Promise<SettlementRow> {
    const row = await this.prisma.employment.findUnique({ where: { id: employmentId }, select: SETTLEMENT_SELECT });
    if (!row) throw new NotFoundException('Employment not found.');
    return row;
  }

  private async settlementViews(rows: readonly SettlementRow[], today: string): Promise<FinalSettlementView[]> {
    const [names, open, unusedLeave] = await Promise.all([
      userNames(this.prisma, rows.map((r) => r.finalSettlement?.settledBy ?? null)),
      rows.length
        ? this.prisma.payrollAdvance.findMany({
            where: { employeeId: { in: [...new Set(rows.map((r) => r.employee.id))] }, status: 'open' },
            orderBy: [{ givenOn: 'asc' }, { createdAt: 'asc' }],
            include: ADVANCE_INCLUDE,
          })
        : [],
      // the annual leave unused on the last working day (18 October 2026)
      this.leave.unused(rows.map((r) => r.id)),
    ]);
    const outstanding = new Map<string, FinalSettlementView['outstanding']>();
    for (const a of open) {
      const left = balanceOf(a).outstanding;
      if (!(left > 0)) continue;
      outstanding.set(a.employeeId, [...(outstanding.get(a.employeeId) ?? []), { advanceId: a.id, kind: a.kind as AdvanceKind, reason: a.reason, outstanding: left }]);
    }
    return rows.map((r) => {
      const s = r.finalSettlement;
      const endDate = fromDateOnly(r.endDate)!;
      const settled = s?.status === 'settled';
      const reason = r.endReason as EndReason | null;
      return {
        employmentId: r.id,
        employee: personOf(r.employee),
        department: placeName(r.department),
        jobTitle: r.jobTitle?.titleEn ?? null,
        joinDate: fromDateOnly(r.joinDate),
        endDate,
        endReason: r.endReason,
        reasonText: r.endings[0]?.rule.label ?? (reason ? (END_REASON_LABELS[reason] ?? reason) : null),
        status: settled ? 'settled' : 'open',
        daysOpen: settled ? 0 : daysBetween(endDate, today),
        reopened: !!s && !settled,
        settledOn: s ? fromDateOnly(s.settledOn) : null,
        amountPaid: s ? s.amountPaid.toNumber() : null,
        note: s?.note ?? null,
        document: s?.document ?? null,
        settledBy: s ? refOf(names, s.settledBy) : null,
        settledAt: s?.settledAt ?? null,
        clearances: r.documents,
        outstanding: outstanding.get(r.employee.id) ?? [],
        unusedLeave: unusedLeave.get(r.id) ?? null,
      };
    });
  }
}
