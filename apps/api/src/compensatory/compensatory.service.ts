import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  adjustmentTaxed,
  COMPENSATORY_RULE_DEFAULTS,
  compensationEarned,
  compensatoryCashDays,
  compensatoryCashReason,
  compensatoryForOdCheck,
  compensatoryMonth,
  compensatoryOffProblems,
  compensatoryRecordCheck,
  compensatoryRequestProblems,
  compensatoryRulesProblems,
  DEFAULT_WORKING_DAYS,
  hoursWorkedProblems,
  shiftWorkHours,
  firstLeaveStatus,
  isOpenLeave,
  LEAVE_STATUS_LABELS,
  leaveDecisionNeedsComment,
  leaveDecisionStepKind,
  leaveStage,
  leaveStatusAfterApproval,
  locksMonth,
  NO_CHECK_IN_WARNING,
  type CompensationAsked,
  type CompensationEarned,
  type CompensatoryOffDay,
  type CompensatoryOutcome,
  type CompensatoryRules,
  type CompensatoryWorkedDay,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type PayrollStatus,
} from '@trendlix/shared';
import { AttendanceFillService } from '../attendance/attendance-fill.service.js';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, shownDate, todayInCairo, toDateOnly, weekday } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  decidedOnBehalfOf,
  decidesStage,
  hiddenRequest,
  hrMayCancel,
  isConfidentialRequest,
  isHr,
  isRequestManager,
  isRequester,
  othersWhere,
  scopeWhere,
  seesRequest,
  standInRefusal,
  waitingWhere,
  type Caller,
} from '../leave/access.js';
import { standInViewOf } from '../leave/stand-ins.js';
import { placeOf, SETTINGS_ENTITY } from '../leave/views.js';
import { NoticesService } from '../notifications/notices.service.js';
import { approverFor } from '../organisation/departments/leads.js';
import { RunAdjustmentsService } from '../payroll/adjustments/run-adjustments.service.js';
import { ADJUSTMENT } from '../payroll/adjustments/views.js';
import { userNames } from '../payroll/adjustments/people.js';
import { firstDay, lastDay, monthName } from '../payroll/months.js';
import { STATUS_TEXT } from '../payroll/status.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CompensatoryCalendarQueryDto,
  CompensatoryCheckQueryDto,
  CompensatoryFormQueryDto,
  CreateCompensatoryDto,
  DecideCompensatoryDto,
  HrCancelCompensatoryDto,
  ListCompensatoryDto,
  RecordCompensatoryDto,
  UpdateCompensatorySettingsDto,
} from './compensatory.dto.js';
import {
  cashRateOf,
  COMPENSATORY_ENTITY,
  COMPENSATORY_INCLUDE,
  COMPENSATORY_TYPE,
  compensatoryParties,
  compensatoryView,
  type CompensatoryCalendarItem,
  type CompensatoryFormView,
  type CompensatoryRequestView,
  type CompensatoryRow,
} from './compensatory-views.js';

type Db = PrismaService | Prisma.TransactionClient;
type Where = Prisma.CompensatoryRequestWhereInput;

const NOT_FOUND = 'Compensatory day request not found.';

/** Said when a compensatory day an official duty carries (27 October 2026) is acted on by itself. */
const WITH_OD = (dayWorked: Date, what: string) => `This compensatory day goes with the official duty on ${shownDate(fromDateOnly(dayWorked)!)}: ${what}`;

/** Approved and being decided: the days that block the same day for another request. */
const TAKING = ['with_manager', 'with_hr', 'approved'] as const;

/** A day off asked for and not paid in cash instead: what takes the day off. */
const TAKES_DAY_OFF: Where = { OR: [{ outcome: null }, { outcome: { not: 'cash' } }] };

/** How far the request form looks either side of a day for its live checks. */
const WINDOW_DAYS = 62;

/** A status as a message says it: "with HR", "approved". */
const statusWords = (status: string) => {
  const label = LEAVE_STATUS_LABELS[status as LeaveStatus] ?? status;
  return label[0].toLowerCase() + label.slice(1);
};

/** An employment as compensatory days read it: its dates, who is in charge, the shift's working days. */
const EMPLOYMENT = {
  id: true,
  employeeId: true,
  employmentType: true,
  joinDate: true,
  endDate: true,
  managerId: true,
  departmentId: true,
  shift: { select: { workingDays: true, startTime: true, endTime: true, hoursPerDay: true } },
  employee: { select: { fullNameEn: true } },
} satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

/** The employment as the compensatory days read it from elsewhere (an official duty's): its dates, approver, shift. */
export type CompensatoryEmployment = Pick<EmploymentRow, 'id' | 'employeeId' | 'employmentType' | 'joinDate' | 'endDate' | 'managerId' | 'departmentId' | 'employee'> & {
  shift: { workingDays: number[]; startTime?: Date; endTime?: Date; hoursPerDay?: Prisma.Decimal | null } | null;
};

/** The shift's hours to work a day (null without a shift, or without its times). */
const hoursADayOf = (e: CompensatoryEmployment | null): number | null =>
  e?.shift?.startTime && e.shift.endTime
    ? shiftWorkHours({ startTime: fromTimeOfDay(e.shift.startTime), endTime: fromTimeOfDay(e.shift.endTime), hoursPerDay: e.shift.hoursPerDay?.toNumber() ?? null })
    : null;

/** Cash instead made: its addition, for its audit entry and the draft payroll. */
type CashMade = { adjustmentId: string; employeeCode: string; month: string; days: number; reason: string; employeeId: string };

/** The compensatory day an official duty carries, as the duty's steps read it (OdService). */
export type OdCompensatoryRow = {
  id: string;
  status: string;
  employeeId: string;
  employmentId: string;
  dayWorked: Date;
  dayOff: Date | null;
  outcome: string | null;
  hoursOff: Prisma.Decimal | null;
  adjustmentId: string | null;
};

/** What saving one with its official duty made, for what follows once it is committed. */
export interface OdCompensatoryMade {
  id: string;
  employeeId: string;
  dayWorked: string;
  dayOff: string | null;
  outcome: CompensatoryOutcome;
  hoursWorked: number | null;
  hoursOff: number | null;
  status: LeaveStatus;
  byHr: boolean;
  cash: CashMade | null;
}

/** What following its official duty's step did. */
export interface OdCompensatoryFollowed {
  from: LeaveStatus;
  to: LeaveStatus;
  outcome: CompensatoryOutcome;
  cash: CashMade | null;
  cancelledAdjustment: string | null;
}

/** What a request's hours earn, as kept on it (its hours off; null: a whole day). */
const earnedOf = (r: { hoursOff: Prisma.Decimal | null }): CompensationEarned => (r.hoursOff ? { kind: 'hours', hours: r.hoursOff.toNumber() } : { kind: 'day' });

// Compensatory days (owner, 26 October 2026: "is there compensatory leaves in the system?"; then "my compensatory is a
// compensation with another day in the same month. and rarely to be compensated in cash"; packages/shared
// compensatory.ts). Someone who worked a rest day of their shift or an official holiday asks, from My Requests, for a
// working day off in the same calendar month, before or after it, under their current employment (not a freelancer's);
// a day before the day off at the latest ("only HR records" a day off that is past); refused with every reason: the day
// worked a working day, one already claimed or in the future; the day off a rest day, a holiday, leave, work from home,
// official duty or another compensatory day off; either in a month whose payroll is with the CEO, approved or paid. A
// day worked with no check-in kept is a warning HR confirms when deciding. Decided as work from home is ("Manager, then
// HR": the approver in charge, then HR; a C-level person's HR stage the CEO's), and HR approves it as a day off (the
// default) or, rarely, as cash instead ("if paid in cash make it 1.5": a payroll addition "Compensation for working
// <day>" in days, a Bonus (days), the Leave Setup's rate, the draft of the day worked's month). "if the day is
// compensated with a day, we pay nothing": a day off adds no money anywhere (the attendance reads it as a full paid day
// and leaves the day worked's hours out of the month: attendance-days.service.ts). The employee withdraws theirs while
// it is being decided; HR cancels an approved one with a reason (the day off is a working day again, or the pending
// addition is cancelled); HR records one for someone, past days too. Each step is logged on the request and in the audit
// log; the approver is told of a request waiting for them, the employee of their own decided (NoticesService).
// Since 27 October 2026 (owner: "Hours off for hours worked", the Compensatory Setup): part of a rest day worked (its
// hours sent) earns hours off on the day off, or their pay in cash, by the Setup's rules; fewer than its minimum nothing;
// and an official duty on a rest day or an official holiday carries its own compensatory day, asked and recorded with it
// (OdService), decided, rejected and cancelled with it, never on its own (forOd, followOd).
@Injectable()
export class CompensatoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
    private readonly fill: AttendanceFillService,
    private readonly runs: RunAdjustmentsService,
  ) {}

  // ---------- the employee's own ----------

  /** The caller's own requests, the latest day worked first; none without an employee profile. */
  async mine(user: SessionUser): Promise<CompensatoryRequestView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.compensatoryRequest.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ dayWorked: 'desc' }, { createdAt: 'desc' }], include: COMPENSATORY_INCLUDE });
    return this.views(rows, caller);
  }

  /** What the request form checks live, around a day (this month in Cairo unless sent): GET /me/compensatory/form. */
  async form(query: CompensatoryFormQueryDto, user: SessionUser): Promise<CompensatoryFormView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Your sign-in has no employee profile, so there are no compensatory days.');
    const today = todayInCairo();
    const around = query.around ?? today;
    const from = addDays(firstDay(around.slice(0, 7)), -WINDOW_DAYS);
    const to = addDays(lastDay(around.slice(0, 7)), WINDOW_DAYS);
    const employment = await this.currentEmployment(caller.employeeId);
    const refusal = this.refusalOf(employment);
    const employeeId = caller.employeeId;
    const range = { gte: toDateOnly(from), lte: toDateOnly(to) };
    const [holidays, leave, wfh, od, own, days, punches] = await Promise.all([
      this.prisma.holiday.findMany({ where: { date: range }, select: { date: true, nameEn: true }, orderBy: { date: 'asc' } }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: range.lte }, endDate: { gte: range.gte } },
        select: { startDate: true, endDate: true, status: true, type: { select: { nameEn: true } } },
      }),
      this.prisma.wfhRequest.findMany({ where: { employeeId, status: { in: [...TAKING] }, date: range }, select: { date: true } }),
      this.prisma.odRequest.findMany({ where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: range.lte }, endDate: { gte: range.gte } }, select: { startDate: true, endDate: true } }),
      this.prisma.compensatoryRequest.findMany({ where: { employeeId, status: { in: [...TAKING] }, OR: [{ dayWorked: range }, { dayOff: range }] }, select: { dayWorked: true, dayOff: true, outcome: true, hoursOff: true } }),
      this.prisma.attendanceDay.findMany({ where: { employeeId, date: range, checkIn: { not: null } }, select: { date: true } }),
      this.prisma.attendancePunch.findMany({ where: { employeeId, date: range, kind: 'in' }, select: { date: true } }),
    ]);
    const leaveRows: CompensatoryFormView['leave'] = [];
    for (const l of leave) {
      for (let d = fromDateOnly(l.startDate); d <= fromDateOnly(l.endDate); d = addDays(d, 1)) {
        if (d >= from && d <= to) leaveRows.push({ date: d, type: l.type.nameEn, status: statusWords(l.status) });
      }
    }
    const other: CompensatoryFormView['other'] = [
      ...wfh.map((w) => ({ date: fromDateOnly(w.date), what: 'a work from home day' })),
      ...own.flatMap((c) => (c.dayOff && c.outcome !== 'cash' ? [{ date: fromDateOnly(c.dayOff), what: c.hoursOff ? 'compensatory hours off' : 'a compensatory day off' }] : [])),
    ];
    for (const o of od) {
      for (let d = fromDateOnly(o.startDate); d <= fromDateOnly(o.endDate); d = addDays(d, 1)) if (d >= from && d <= to) other.push({ date: d, what: 'an official duty' });
    }
    const rules = await this.rules();
    return {
      refusal,
      offered: !refusal,
      hasShift: !!employment?.shift,
      today,
      cashDays: rules.cashRate,
      // the Compensatory Setup and the shift's hours a day, for what part of a day earns (27 October 2026)
      rules,
      hoursADay: hoursADayOf(employment),
      workingDays: [...(employment?.shift?.workingDays ?? DEFAULT_WORKING_DAYS)],
      holidays: holidays.map((h) => ({ date: fromDateOnly(h.date), nameEn: h.nameEn })),
      leave: leaveRows,
      other,
      claimed: own.map((c) => fromDateOnly(c.dayWorked)),
      checkedIn: [...new Set([...days, ...punches].map((d) => fromDateOnly(d.date)))].sort(),
      from,
      to,
    };
  }

  /** An employee's request for themself, under their current employment. */
  async create(dto: CreateCompensatoryDto, user: SessionUser): Promise<CompensatoryRequestView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Only an employee can ask for a compensatory day: your sign-in has no employee profile.');
    const employment = await this.currentEmployment(caller.employeeId);
    if (!employment) throw new ConflictException("You have no current employment, so you can't ask for a compensatory day.");
    const id = await this.submit(employment, { dayWorked: dto.dayWorked, dayOff: dto.dayOff, reason: dto.reason ?? null, outcome: null, hoursWorked: dto.hoursWorked ?? null }, caller, false);
    // to the one in charge of its first step, once it is saved
    await this.notices.compensatory(id, 'sent');
    return this.one(id, user);
  }

  /** The employee withdraws their own request while it is being decided. */
  async cancelMine(id: string, user: SessionUser): Promise<CompensatoryRequestView> {
    const caller = await this.caller(user);
    const before = await this.prisma.compensatoryRequest.findUnique({ where: { id } });
    if (!before || !isRequester(before, caller)) throw new NotFoundException(NOT_FOUND);
    if (before.odRequestId) throw new ConflictException(WITH_OD(before.dayWorked, 'cancel the official duty, and it is cancelled with it.'));
    if (!isOpenLeave(before.status)) {
      throw new ConflictException(
        before.status === 'approved'
          ? 'This compensatory day is approved, so it can no longer be cancelled here. Ask HR to cancel it.'
          : `This request is ${statusWords(before.status)}, so it can't be cancelled.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.compensatoryRequest.updateMany({ where: { id, status: before.status }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException("This request was decided meanwhile, so it can't be cancelled. Reload the page to see where it is.");
      await this.step(tx, id, user.id, { kind: 'cancelled' });
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: COMPENSATORY_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, dayWorked: fromDateOnly(before.dayWorked), dayOff: fromDateOnly(before.dayOff), status: { from: before.status, to: 'cancelled' } },
    });
    return this.one(id, user);
  }

  // ---------- HR on someone's behalf ----------

  /** What HR recording one for someone would meet (GET /compensatory/check): what refuses it and what it is recorded past. */
  async check(
    query: CompensatoryCheckQueryDto,
    user: SessionUser,
  ): Promise<{ employee: { id: string; fullNameEn: string }; problems: string[]; warnings: string[]; cashDays: number; earned: CompensationEarned; rules: CompensatoryRules }> {
    const caller = await this.caller(user);
    const person = await this.prisma.employee.findUnique({ where: { id: query.employeeId }, select: { id: true, fullNameEn: true } });
    if (!person || caller.confidential?.hidden.has(query.employeeId)) throw new NotFoundException('Employee not found.');
    const rules = await this.rules();
    const hoursWorked = query.hoursWorked ?? null;
    // part of the day (27 October 2026): what its hours earn, and cash instead in days' pay for it
    const earned = compensationEarned(hoursWorked, rules);
    const employment = await this.employmentOn(query.employeeId, query.dayWorked);
    const cashDays = compensatoryCashDays(earned, rules, hoursADayOf(employment));
    const answer = { employee: person, cashDays, earned, rules };
    if (!employment) return { ...answer, problems: [`Choose a day within one of ${person.fullNameEn}'s employments.`], warnings: [] };
    const refusal = this.refusalOf(employment, person.fullNameEn);
    if (refusal) return { ...answer, problems: [refusal], warnings: [] };
    const states = await this.dayStates(this.prisma, employment, query.dayWorked, query.dayOff ?? null);
    const checked = compensatoryRecordCheck(query.dayWorked, query.dayOff ?? null, states.worked, states.off, todayInCairo(), person.fullNameEn, rules);
    return { ...answer, problems: [...hoursWorkedProblems(hoursWorked, rules, person.fullNameEn), ...checked.problems], warnings: checked.warnings };
  }

  /**
   * HR records a compensatory day for someone (a past day off too, a cash one without a day off): approved at once, under
   * the employment the day worked is in, the warnings kept with it and in the audit log. Never HR's own.
   */
  async record(dto: RecordCompensatoryDto, user: SessionUser): Promise<CompensatoryRequestView> {
    const caller = await this.caller(user);
    if (!isHr(user)) throw new ForbiddenException('Only HR records a compensatory day for someone.');
    if (caller.employeeId === dto.employeeId) throw new ForbiddenException('Someone else in HR has to record your own compensatory day, or ask for it from My Requests.');
    const person = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { fullNameEn: true } });
    if (!person || caller.confidential?.hidden.has(dto.employeeId)) throw new NotFoundException('Employee not found.');
    const employment = await this.employmentOn(dto.employeeId, dto.dayWorked);
    if (!employment) throw new BadRequestException([`Choose a day within one of ${person.fullNameEn}'s employments.`]);
    const outcome: CompensatoryOutcome = dto.outcome ?? 'day_off';
    if (outcome === 'day_off' && !dto.dayOff) throw new BadRequestException(['Enter the day off, e.g. 2026-11-10.']);
    const id = await this.submit(employment, { dayWorked: dto.dayWorked, dayOff: outcome === 'cash' ? null : dto.dayOff!, reason: dto.reason, outcome, hoursWorked: dto.hoursWorked ?? null }, caller, true);
    return this.one(id, user);
  }

  /** HR cancels an approved one, saying why. Never HR's own; a C-level person's only HR who sees them. */
  async hrCancel(id: string, dto: HrCancelCompensatoryDto, user: SessionUser): Promise<CompensatoryRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = compensatoryParties(before);
    if (!isHr(user)) throw new ForbiddenException('Only HR cancels an approved compensatory day.');
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else in HR has to cancel your own compensatory day.');
    if (before.odRequestId) throw new ConflictException(WITH_OD(before.dayWorked, 'cancel the official duty, and it is cancelled with it.'));
    if (!hrMayCancel({ ...parties, status: before.status }, caller)) {
      throw new ConflictException(`This request is ${statusWords(before.status)}: HR cancels approved compensatory days only. ${isOpenLeave(before.status) ? 'Reject it instead.' : ''}`.trim());
    }
    const dayWorked = fromDateOnly(before.dayWorked);
    await this.assertMonthOpen(compensatoryMonth(dayWorked));
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.compensatoryRequest.updateMany({ where: { id, status: 'approved' }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException('This request was cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: 'cancelled', comment: dto.comment });
      // cash instead: the addition on the draft payroll is cancelled with it (a month with the CEO or paid refused above)
      if (before.outcome !== 'cash' || !before.adjustmentId) return null;
      const { count: gone } = await tx.payrollAdjustment.updateMany({ where: { id: before.adjustmentId, status: 'pending' }, data: { status: 'cancelled', cancelledById: user.id, cancelledAt: new Date() } });
      return gone ? before.adjustmentId : null;
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: COMPENSATORY_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, dayWorked, dayOff: fromDateOnly(before.dayOff), outcome: before.outcome, status: { from: 'approved', to: 'cancelled' }, comment: dto.comment },
    });
    if (cancelled) {
      await this.audit.record({
        userId: user.id,
        action: 'cancel',
        entityType: ADJUSTMENT,
        entityId: cancelled,
        diff: { month: compensatoryMonth(dayWorked), kind: 'addition', type: 'bonus_days', status: { from: 'pending', to: 'cancelled' }, compensatoryId: id },
      });
      await this.runs.syncDrafts([compensatoryMonth(dayWorked)], [before.employeeId], user);
    }
    await this.refill(before.employeeId, dayWorked, user, fromDateOnly(before.dayOff));
    await this.notices.compensatory(id, 'cancelled_by_hr');
    return this.one(id, user);
  }

  // ---------- deciding and seeing them ----------

  /**
   * The requests the caller sees, the latest day worked first: HR and the CEO everyone's (a C-level person's only the
   * CEO's and HR's with Super Admin, and the approver it was sent to); a manager or a lead those sent to them and their
   * team's. `waiting`: theirs to decide.
   */
  async list(query: ListCompensatoryDto, user: SessionUser): Promise<CompensatoryRequestView[]> {
    const caller = await this.caller(user);
    const rows = await this.prisma.compensatoryRequest.findMany({
      where: {
        AND: [
          othersWhere(caller) as Where,
          // one an official duty carries waits as the official duty, not by itself (27 October 2026)
          query.status === 'waiting' ? { AND: [waitingWhere(caller) as Where, { odRequestId: null }] } : query.status ? { status: query.status } : {},
          query.employeeId ? { employeeId: query.employeeId } : {},
          query.departmentId ? { employment: { OR: [{ departmentId: query.departmentId }, { department: { parentId: query.departmentId } }] } } : {},
          query.from ? { dayWorked: { gte: toDateOnly(query.from) } } : {},
          query.to ? { dayWorked: { lte: toDateOnly(query.to) } } : {},
        ],
      },
      orderBy: [{ dayWorked: 'desc' }, { createdAt: 'desc' }],
      include: COMPENSATORY_INCLUDE,
    });
    return this.views(rows, caller);
  }

  /** { waiting }: how many wait for the caller's decision (the sidebar, Approvals and To Approve count them). */
  async counts(user: SessionUser): Promise<{ waiting: number }> {
    const caller = await this.caller(user);
    return { waiting: await this.prisma.compensatoryRequest.count({ where: { AND: [waitingWhere(caller) as Where, { odRequestId: null }] } }) };
  }

  async one(id: string, user: SessionUser): Promise<CompensatoryRequestView> {
    const caller = await this.caller(user);
    return (await this.views([await this.visible(id, caller)], caller))[0];
  }

  /**
   * The decision of the stage the request is at, by its decider: the approver it was sent to, then HR (a C-level person's:
   * the CEO); never the employee's own. Approve moves it on; HR's approves it as a day off (the default) or cash instead
   * (a day worked with no check-in kept needs `confirmNoCheckIn`); reject, with a comment, ends it.
   */
  async decide(id: string, dto: DecideCompensatoryDto, user: SessionUser): Promise<CompensatoryRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = compensatoryParties(before);
    const stage = leaveStage(before.status);
    if (!stage) throw new ConflictException(`This request is ${statusWords(before.status)}, so there is nothing left to decide. Reload the page to see it.`);
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else has to decide your own compensatory day request.');
    if (before.odRequestId) throw new ConflictException(WITH_OD(before.dayWorked, 'it is decided with the official duty.'));
    const away = standInRefusal({ ...parties, status: before.status }, caller);
    if (away) throw new ConflictException(away);
    if (!decidesStage(stage, parties, caller)) {
      if (isRequestManager(parties, caller) || decidesStage('hr', parties, caller)) {
        throw new ConflictException(`This request is ${statusWords(before.status)} now, so it isn't waiting for your decision. Reload the page to see where it is.`);
      }
      throw new ForbiddenException(
        isConfidentialRequest(parties, caller)
          ? "A C-level person's compensatory day request is decided by its approver, then the CEO."
          : "Only the request's approver and HR decide a compensatory day request.",
      );
    }
    const comment = dto.comment ?? null;
    if (leaveDecisionNeedsComment(dto.decision) && !comment) throw new BadRequestException('Write a comment: why the compensatory day is rejected.');
    const to: LeaveStatus = dto.decision === 'reject' ? 'rejected' : leaveStatusAfterApproval(stage);
    const dayWorked = fromDateOnly(before.dayWorked);
    const dayOff = fromDateOnly(before.dayOff);
    const approvesNow = to === 'approved';
    const outcome: CompensatoryOutcome | null = approvesNow ? (dto.outcome ?? 'day_off') : null;
    if (dto.outcome && !approvesNow) throw new BadRequestException(["Only HR's approval chooses a day off or cash instead."]);
    let cashDays = 0;
    if (approvesNow) {
      const employment = await this.prisma.employment.findUnique({ where: { id: before.employmentId }, select: EMPLOYMENT });
      // cash instead: a whole day's rate, or the hours' share of it (27 October 2026)
      cashDays = compensatoryCashDays(earnedOf(before), await this.rules(), hoursADayOf(employment));
      await this.assertMonthOpen(compensatoryMonth(dayWorked));
      const states = await this.dayStates(this.prisma, employment!, dayWorked, outcome === 'day_off' ? dayOff : null, id);
      if (!states.worked.checkedIn && dto.confirmNoCheckIn !== true) {
        throw new ConflictException(`${NO_CHECK_IN_WARNING(dayWorked)} Confirm it was worked to approve.`);
      }
      if (outcome === 'day_off') {
        const offProblems = compensatoryOffProblems(dayOff!, states.off!, before.employee.fullNameEn);
        if (offProblems.length) throw new ConflictException(offProblems);
      }
    }
    const onBehalfOf = decidedOnBehalfOf(stage, parties, caller);
    const made = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.compensatoryRequest.updateMany({
        where: { id, status: before.status },
        data: to === 'rejected' ? { status: to, rejectedStage: stage, rejectReason: comment } : approvesNow ? { status: to, outcome } : { status: to },
      });
      if (!count) throw new ConflictException('This request was decided or cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: leaveDecisionStepKind(stage), decision: dto.decision, comment, onBehalfOf });
      return outcome === 'cash' ? await this.makeCash(tx, { id, employeeId: before.employeeId, dayWorked }, cashDays, user.id) : null;
    });
    await this.audit.record({
      userId: user.id,
      action: dto.decision === 'reject' ? 'reject' : 'approve',
      entityType: COMPENSATORY_ENTITY,
      entityId: id,
      diff: {
        employeeId: before.employeeId,
        dayWorked,
        dayOff,
        stage,
        decision: dto.decision,
        status: { from: before.status, to },
        ...(outcome && { outcome }),
        ...(approvesNow && dto.confirmNoCheckIn === true && { confirmedNoCheckIn: true }),
        ...(comment && { comment }),
        ...(onBehalfOf && { standingInFor: onBehalfOf }),
      },
    });
    if (approvesNow) {
      if (made) await this.auditCash(made, id, user);
      await this.refill(before.employeeId, dayWorked, user, dayOff);
    }
    // to the next step's decider, or the employee once it is approved or rejected
    await this.notices.compensatory(id, 'decided');
    return this.one(id, user);
  }

  /**
   * The compensatory days off on the leave calendar from `from` to `to`: approved, and for HR those being decided too, as
   * far as the caller sees requests, by a department and its teams. A cash one has no day off.
   */
  async calendar(query: CompensatoryCalendarQueryDto, user: SessionUser): Promise<CompensatoryCalendarItem[]> {
    const caller = await this.caller(user);
    const today = todayInCairo();
    const from = query.from ?? `${today.slice(0, 7)}-01`;
    const to = query.to ?? lastDay(today.slice(0, 7));
    if (to < from) throw new BadRequestException(["The last day can't be before the first."]);
    if (Number(toDateOnly(to)) - Number(toDateOnly(from)) > 366 * 86_400_000) throw new BadRequestException(['Choose at most a year of days.']);
    const rows = await this.prisma.compensatoryRequest.findMany({
      where: {
        AND: [
          scopeWhere(caller) as Where,
          TAKES_DAY_OFF,
          { dayOff: { not: null } },
          { status: { in: isHr(user) ? [...TAKING] : ['approved'] } },
          { dayOff: { gte: toDateOnly(from), lte: toDateOnly(to) } },
          query.departmentId ? { employment: { OR: [{ departmentId: query.departmentId }, { department: { parentId: query.departmentId } }] } } : {},
        ],
      },
      orderBy: [{ dayOff: 'asc' }, { employee: { fullNameEn: 'asc' } }],
      select: {
        id: true,
        dayOff: true,
        status: true,
        employee: { select: { id: true, fullNameEn: true } },
        employment: { select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: 'compensatory' as const,
      employee: { id: r.employee.id, fullNameEn: r.employee.fullNameEn, ...placeOf(r.employment.department) },
      type: { id: COMPENSATORY_TYPE.id, nameEn: COMPENSATORY_TYPE.nameEn, nameAr: COMPENSATORY_TYPE.nameAr },
      startDate: fromDateOnly(r.dayOff!),
      endDate: fromDateOnly(r.dayOff!),
      halfDay: false as const,
      status: r.status as LeaveStatus,
    }));
  }

  // ---------- with an official duty (owner, 27 October 2026: "it should count in the compensatories"; "One step") ----------

  /**
   * What the compensatory day an official duty on a rest day or an official holiday comes with meets, in the duty's
   * transaction (the employee's row held): the day not compensated already; a day off (or the day for hours off) free and
   * within the Setup's window, a day ahead for an employee, a warning for HR when past; the months' payroll open. `name`:
   * the employee's when HR records it.
   */
  async odCheck(db: Db, employment: CompensatoryEmployment, dayWorked: string, asked: CompensationAsked, today: string, name: string | null): Promise<{ problems: string[]; warnings: string[] }> {
    const rules = await this.rules(db);
    const dayOff = asked.outcome === 'cash' ? null : asked.dayOff;
    const states = await this.dayStates(db, employment, dayWorked, dayOff);
    const checked = compensatoryForOdCheck(dayWorked, asked, states.worked, states.off, today, name, rules);
    const months = [...new Set([dayWorked, ...(dayOff ? [dayOff] : [])].map(compensatoryMonth))];
    const locks: string[] = [];
    for (const month of months) {
      const lock = await this.monthLockProblem(month, db);
      if (lock) locks.push(lock);
    }
    return { problems: [...checked.problems, ...locks], warnings: checked.warnings };
  }

  /**
   * The compensatory day an official duty carries, saved in the duty's transaction with its status, approver and reason
   * (the duty's): an employee's at the duty's first step, decided with it; HR's approved at once (cash instead made then).
   * `earned`: what the duty's hours earn (never nothing); `hoursWorked`: part of the day's hours (null: a full day).
   */
  async createForOd(
    tx: Prisma.TransactionClient,
    input: {
      odId: string;
      employment: CompensatoryEmployment;
      dayWorked: string;
      asked: CompensationAsked;
      earned: CompensationEarned;
      hoursWorked: number | null;
      status: LeaveStatus;
      managerId: string | null;
      approverRole: string | null;
      byHr: boolean;
      reason: string;
      warnings: string[];
      userId: string;
    },
  ): Promise<OdCompensatoryMade> {
    const { employment, asked, earned, byHr } = input;
    const row = await tx.compensatoryRequest.create({
      data: {
        employeeId: employment.employeeId,
        employmentId: employment.id,
        dayWorked: toDateOnly(input.dayWorked),
        dayOff: asked.outcome === 'cash' || !asked.dayOff ? null : toDateOnly(asked.dayOff),
        reason: input.reason,
        status: input.status,
        // the compensation chosen with the duty, kept from the start (approved as it is)
        outcome: asked.outcome,
        managerId: input.managerId,
        approverRole: input.approverRole,
        recordedByHr: byHr,
        warnings: input.warnings,
        createdById: input.userId,
        hoursWorked: input.hoursWorked,
        hoursOff: earned.kind === 'hours' ? earned.hours : null,
        odRequestId: input.odId,
      },
      select: { id: true },
    });
    const comment = 'With the official duty';
    if (byHr) await this.step(tx, row.id, input.userId, { kind: 'recorded_by_hr', comment });
    else {
      await this.step(tx, row.id, input.userId, { kind: 'submitted', comment });
      if (!input.managerId) await this.step(tx, row.id, null, { kind: 'no_manager' });
    }
    const cash =
      byHr && asked.outcome === 'cash'
        ? await this.makeCash(tx, { id: row.id, employeeId: employment.employeeId, dayWorked: input.dayWorked }, compensatoryCashDays(earned, await this.rules(tx), hoursADayOf(employment)), input.userId)
        : null;
    return {
      id: row.id,
      employeeId: employment.employeeId,
      dayWorked: input.dayWorked,
      dayOff: asked.outcome === 'cash' ? null : asked.dayOff,
      outcome: asked.outcome,
      hoursWorked: input.hoursWorked,
      hoursOff: earned.kind === 'hours' ? earned.hours : null,
      status: input.status,
      byHr,
      cash,
    };
  }

  /** Once the duty carrying one is committed: its audit entry (and its cash addition's), and, approved, the months filled. */
  async createdForOd(made: OdCompensatoryMade, odId: string, user: SessionUser): Promise<void> {
    await this.audit.record({
      userId: user.id,
      action: made.byHr ? 'record' : 'create',
      entityType: COMPENSATORY_ENTITY,
      entityId: made.id,
      diff: {
        employeeId: made.employeeId,
        dayWorked: made.dayWorked,
        dayOff: made.dayOff,
        outcome: made.outcome,
        ...(made.hoursWorked !== null && { hoursWorked: made.hoursWorked, hoursOff: made.hoursOff }),
        status: made.status,
        odRequestId: odId,
      },
    });
    if (made.cash) await this.auditCash(made.cash, made.id, user);
    if (made.status === 'approved') await this.refill(made.employeeId, made.dayWorked, user, made.dayOff);
  }

  /** The compensatory day an official duty carries, while it is being decided or approved; null for none. */
  async ofOd(db: Db, odId: string): Promise<OdCompensatoryRow | null> {
    return db.compensatoryRequest.findFirst({
      where: { odRequestId: odId, status: { in: [...TAKING] } },
      select: { id: true, status: true, employeeId: true, employmentId: true, dayWorked: true, dayOff: true, outcome: true, hoursOff: true, adjustmentId: true },
    });
  }

  /**
   * Before the duty carrying one is approved: its months' payroll open, and its day off still free (refused, 409, with
   * why), as a compensatory day's own approval checks.
   */
  async assertOdApprovable(linked: OdCompensatoryRow, name: string): Promise<void> {
    const dayWorked = fromDateOnly(linked.dayWorked)!;
    const dayOff = fromDateOnly(linked.dayOff);
    await this.assertMonthOpen(compensatoryMonth(dayWorked));
    if (dayOff && compensatoryMonth(dayOff) !== compensatoryMonth(dayWorked)) await this.assertMonthOpen(compensatoryMonth(dayOff));
    if (linked.outcome === 'cash' || !dayOff) return;
    const employment = await this.prisma.employment.findUnique({ where: { id: linked.employmentId }, select: EMPLOYMENT });
    const states = await this.dayStates(this.prisma, employment!, dayWorked, dayOff, linked.id);
    const problems = compensatoryOffProblems(dayOff, states.off!, name);
    if (problems.length) throw new ConflictException(problems);
  }

  /**
   * The compensatory day follows its official duty's step, in the duty's transaction: on to HR, approved (cash instead
   * made), rejected with the duty's comment, or cancelled (a pending cash addition cancelled with it).
   */
  async followOd(
    tx: Prisma.TransactionClient,
    linked: OdCompensatoryRow,
    change: { to: LeaveStatus; stage: LeaveStage | null; decision?: LeaveDecision; comment: string | null; onBehalfOf?: string | null },
    userId: string,
  ): Promise<OdCompensatoryFollowed> {
    const { to, stage } = change;
    const outcome = (linked.outcome as CompensatoryOutcome | null) ?? 'day_off';
    const { count } = await tx.compensatoryRequest.updateMany({
      where: { id: linked.id, status: linked.status },
      data: to === 'rejected' ? { status: to, rejectedStage: stage, rejectReason: change.comment } : to === 'approved' ? { status: to, outcome } : { status: to },
    });
    if (!count) throw new ConflictException('The compensatory day with this official duty was changed meanwhile. Reload the page to see where it is.');
    if (to === 'cancelled') await this.step(tx, linked.id, userId, { kind: 'cancelled', comment: change.comment });
    else await this.step(tx, linked.id, userId, { kind: leaveDecisionStepKind(stage!), decision: change.decision, comment: change.comment, onBehalfOf: change.onBehalfOf ?? null });
    let cash: CashMade | null = null;
    let cancelledAdjustment: string | null = null;
    if (to === 'approved' && outcome === 'cash') {
      const employment = await tx.employment.findUnique({ where: { id: linked.employmentId }, select: EMPLOYMENT });
      const days = compensatoryCashDays(earnedOf(linked), await this.rules(tx), hoursADayOf(employment));
      cash = await this.makeCash(tx, { id: linked.id, employeeId: linked.employeeId, dayWorked: fromDateOnly(linked.dayWorked)! }, days, userId);
    }
    if (to === 'cancelled' && linked.status === 'approved' && linked.outcome === 'cash' && linked.adjustmentId) {
      const { count: gone } = await tx.payrollAdjustment.updateMany({ where: { id: linked.adjustmentId, status: 'pending' }, data: { status: 'cancelled', cancelledById: userId, cancelledAt: new Date() } });
      if (gone) cancelledAdjustment = linked.adjustmentId;
    }
    return { from: linked.status as LeaveStatus, to, outcome, cash, cancelledAdjustment };
  }

  /** Once the duty's step is committed: the compensatory day's audit entry, its addition's, and the months filled again. */
  async followedOd(linked: OdCompensatoryRow, followed: OdCompensatoryFollowed, odId: string, user: SessionUser): Promise<void> {
    const dayWorked = fromDateOnly(linked.dayWorked)!;
    const dayOff = fromDateOnly(linked.dayOff);
    const action = followed.to === 'cancelled' ? 'cancel' : followed.to === 'rejected' ? 'reject' : 'approve';
    await this.audit.record({
      userId: user.id,
      action,
      entityType: COMPENSATORY_ENTITY,
      entityId: linked.id,
      diff: { employeeId: linked.employeeId, dayWorked, dayOff, outcome: followed.outcome, status: { from: followed.from, to: followed.to }, odRequestId: odId },
    });
    if (followed.cash) await this.auditCash(followed.cash, linked.id, user);
    if (followed.cancelledAdjustment) {
      await this.audit.record({
        userId: user.id,
        action: 'cancel',
        entityType: ADJUSTMENT,
        entityId: followed.cancelledAdjustment,
        diff: { month: compensatoryMonth(dayWorked), kind: 'addition', type: 'bonus_days', status: { from: 'pending', to: 'cancelled' }, compensatoryId: linked.id },
      });
      await this.runs.syncDrafts([compensatoryMonth(dayWorked)], [linked.employeeId], user);
    }
    // approved, or an approved one cancelled: the day off and the day worked count differently
    if (followed.to === 'approved' || followed.from === 'approved') await this.refill(linked.employeeId, dayWorked, user, dayOff);
  }

  // ---------- the Compensatory Setup (owner, 27 October 2026: "i need a setup dashboard for the compensatory leaves") ----------

  /** The Compensatory Setup's rules (anyone signed in reads them, as the Leave Setup's numbers). */
  async settings(): Promise<CompensatoryRules> {
    return this.rules();
  }

  /**
   * HR changes the Compensatory Setup: the cash rate, the minimum hours to qualify, the most hours off, the hours for a
   * whole day and when the day off is taken (each left out as it is), refused with every reason; in the audit log as the
   * Leave Setup's change. Requests already made keep the hours off they earned.
   */
  async updateSettings(dto: UpdateCompensatorySettingsDto, user: SessionUser): Promise<CompensatoryRules> {
    const before = await this.rules();
    const after: CompensatoryRules = {
      cashRate: dto.cashRate ?? before.cashRate,
      minHours: dto.minHours ?? before.minHours,
      hoursCap: dto.hoursCap ?? before.hoursCap,
      fullDayHours: dto.fullDayHours ?? before.fullDayHours,
      offWithinDays: dto.offWithinDays === undefined ? before.offWithinDays : dto.offWithinDays,
    };
    const problems = compensatoryRulesProblems(after);
    if (problems.length) throw new BadRequestException(problems);
    const data = {
      compensatoryCashRate: after.cashRate,
      compensatoryMinHours: after.minHours,
      compensatoryHoursCap: after.hoursCap,
      compensatoryFullDayHours: after.fullDayHours,
      compensatoryOffWithinDays: after.offWithinDays,
      updatedById: user.id,
    };
    await this.prisma.leaveSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    const named = (r: CompensatoryRules) => ({
      compensatoryCashRate: r.cashRate,
      compensatoryMinHours: r.minHours,
      compensatoryHoursCap: r.hoursCap,
      compensatoryFullDayHours: r.fullDayHours,
      compensatoryOffWithinDays: r.offWithinDays,
    });
    const diff = changes(named(before), named(after));
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: SETTINGS_ENTITY, diff });
    return after;
  }

  // ---------- helpers ----------

  /** The Compensatory Setup's rules (the migration's row; the owner's numbers should it be missing). */
  async rules(db: Db = this.prisma): Promise<CompensatoryRules> {
    const s = await db.leaveSettings.findUnique({
      where: { id: 1 },
      select: { compensatoryCashRate: true, compensatoryMinHours: true, compensatoryHoursCap: true, compensatoryFullDayHours: true, compensatoryOffWithinDays: true },
    });
    if (!s) return { ...COMPENSATORY_RULE_DEFAULTS };
    return {
      cashRate: cashRateOf(s),
      minHours: s.compensatoryMinHours.toNumber(),
      hoursCap: s.compensatoryHoursCap.toNumber(),
      fullDayHours: s.compensatoryFullDayHours.toNumber(),
      offWithinDays: s.compensatoryOffWithinDays,
    };
  }

  /** The Setup's cash rate. */
  async cashRate(db: Db = this.prisma): Promise<number> {
    return (await this.rules(db)).cashRate;
  }

  /** The caller, with their own employee profile and the C-level people. */
  async caller(user: SessionUser): Promise<Caller> {
    const [me, confidential] = await Promise.all([
      user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { id: true } }) : null,
      this.confidential.view(user),
    ]);
    return { user, employeeId: me?.id ?? null, confidential, standIn: await standInViewOf(this.prisma, me?.id ?? null, user) };
  }

  private currentEmployment(employeeId: string): Promise<EmploymentRow | null> {
    return this.prisma.employment.findFirst({ where: { employeeId, endDate: null }, orderBy: { joinDate: 'desc' }, select: EMPLOYMENT });
  }

  private employmentOn(employeeId: string, date: string): Promise<EmploymentRow | null> {
    return this.prisma.employment.findFirst({
      where: { employeeId, joinDate: { lte: toDateOnly(date) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(date) } }] },
      orderBy: { joinDate: 'desc' },
      select: EMPLOYMENT,
    });
  }

  /** Why someone can't have a compensatory day at all under an employment (null: they may): none; a freelancer. */
  private refusalOf(employment: EmploymentRow | null, name: string | null = null): string | null {
    if (!employment) return name ? `${name} has no current employment.` : "You have no current employment, so you can't ask for a compensatory day.";
    if (employment.employmentType === 'freelance') {
      return `${name ? `${name} works` : 'You work'} freelance, outside the labour law and its working hours: there is no compensatory day.`;
    }
    return null;
  }

  /** The month's payroll must not be with the CEO, approved or paid: its days and additions can't change then. */
  private async assertMonthOpen(month: string, db: Db = this.prisma): Promise<void> {
    const problem = await this.monthLockProblem(month, db);
    if (problem) throw new ConflictException(problem);
  }

  /** Why a month's days can't change (null: they can): its payroll with the CEO, approved or paid. */
  private async monthLockProblem(month: string, db: Db = this.prisma): Promise<string | null> {
    const run = await db.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { status: true } });
    if (run && locksMonth(run.status)) return `The ${monthName(month)} payroll ${STATUS_TEXT[run.status as PayrollStatus]}, so its days can't change. Choose days in another month.`;
    return null;
  }

  /** The two days as the shared rules read them, for the person under `employment`; `except`: a request left out. */
  private async dayStates(db: Db, employment: CompensatoryEmployment, dayWorked: string, dayOff: string | null, except?: string): Promise<{ worked: CompensatoryWorkedDay; off: CompensatoryOffDay | null }> {
    const employeeId = employment.employeeId;
    const working = employment.shift?.workingDays ?? DEFAULT_WORKING_DAYS;
    const not = except ? { id: { not: except } } : {};
    const [holiday, claimed, days, punches] = await Promise.all([
      db.holiday.findUnique({ where: { date: toDateOnly(dayWorked) }, select: { nameEn: true } }),
      db.compensatoryRequest.count({ where: { employeeId, dayWorked: toDateOnly(dayWorked), status: { in: [...TAKING] }, ...not } }),
      db.attendanceDay.count({ where: { employeeId, date: toDateOnly(dayWorked), checkIn: { not: null } } }),
      db.attendancePunch.count({ where: { employeeId, date: toDateOnly(dayWorked), kind: 'in' } }),
    ]);
    const worked: CompensatoryWorkedDay = { workingDay: working.includes(weekday(dayWorked)), holiday: holiday?.nameEn ?? null, claimed: claimed > 0, checkedIn: days + punches > 0 };
    if (dayOff === null) return { worked, off: null };
    const at = toDateOnly(dayOff);
    const [offHoliday, leave, wfh, od, comp] = await Promise.all([
      db.holiday.findUnique({ where: { date: at }, select: { nameEn: true } }),
      db.leaveRequest.findFirst({
        where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: at }, endDate: { gte: at } },
        orderBy: { startDate: 'asc' },
        select: { status: true, type: { select: { nameEn: true } } },
      }),
      db.wfhRequest.count({ where: { employeeId, status: { in: [...TAKING] }, date: at } }),
      db.odRequest.count({ where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: at }, endDate: { gte: at } } }),
      db.compensatoryRequest.count({ where: { employeeId, status: { in: [...TAKING] }, dayOff: at, AND: [TAKES_DAY_OFF], ...not } }),
    ]);
    const other = comp > 0 ? 'a compensatory day off' : wfh > 0 ? 'a work from home day' : od > 0 ? 'an official duty' : null;
    return {
      worked,
      off: { workingDay: working.includes(weekday(dayOff)), holiday: offHoliday?.nameEn ?? null, leave: leave ? { type: leave.type.nameEn, status: statusWords(leave.status) } : null, other },
    };
  }

  /**
   * A request saved, checked in a transaction holding the employee's row: an employee's against both days and the notice,
   * sent to the approver in charge (or HR); HR's against the days only, approved at once with what it was recorded past.
   */
  private async submit(
    employment: EmploymentRow,
    input: { dayWorked: string; dayOff: string | null; reason: string | null; outcome: CompensatoryOutcome | null; hoursWorked: number | null },
    caller: Caller,
    byHr: boolean,
  ): Promise<string> {
    const user = caller.user;
    const employeeId = employment.employeeId;
    const name = byHr ? employment.employee.fullNameEn : null;
    const refusal = this.refusalOf(employment, name);
    if (refusal) throw new BadRequestException([refusal]);
    const inEmployment: string[] = [];
    const joinDate = fromDateOnly(employment.joinDate);
    const endDate = fromDateOnly(employment.endDate);
    for (const [label, day] of [['day worked', input.dayWorked], ['day off', input.dayOff]] as const) {
      if (day === null) continue;
      if (day < joinDate) inEmployment.push(`The ${label} must be within the employment, which started on ${shownDate(joinDate)}.`);
      if (endDate && day > endDate) inEmployment.push(`The ${label} must be within the employment, which ended on ${shownDate(endDate)}.`);
    }
    // a month with the CEO, approved or paid keeps its days and additions as they are (the day off's too, in another
    // month by the Setup's window)
    await this.assertMonthOpen(compensatoryMonth(input.dayWorked));
    if (input.dayOff && compensatoryMonth(input.dayOff) !== compensatoryMonth(input.dayWorked)) await this.assertMonthOpen(compensatoryMonth(input.dayOff));
    const approver = await approverFor(this.prisma, { employeeId, managerId: employment.managerId, departmentId: employment.departmentId });
    const managerId = approver?.employeeId ?? null;
    const approverRole = approver?.role ?? null;
    const status: LeaveStatus = byHr ? 'approved' : firstLeaveStatus(managerId !== null);
    const today = todayInCairo();
    // part of the day (27 October 2026): what its hours earn by the Setup, and cash instead for it
    const rules = await this.rules();
    const earned = compensationEarned(input.hoursWorked, rules);
    const hoursProblems = hoursWorkedProblems(input.hoursWorked, rules, name);
    const cashDays = compensatoryCashDays(earned, rules, hoursADayOf(employment));

    const made = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const states = await this.dayStates(tx, employment, input.dayWorked, input.dayOff);
      let warnings: string[] = [];
      if (byHr) {
        const checked = compensatoryRecordCheck(input.dayWorked, input.dayOff, states.worked, states.off, today, employment.employee.fullNameEn, rules);
        if (inEmployment.length || hoursProblems.length || checked.problems.length) throw new BadRequestException([...inEmployment, ...hoursProblems, ...checked.problems]);
        warnings = checked.warnings;
      } else {
        const problems = [...inEmployment, ...hoursProblems, ...compensatoryRequestProblems(input.dayWorked, input.dayOff!, states.worked, states.off!, today, rules)];
        if (problems.length) throw new BadRequestException(problems);
      }
      const row = await tx.compensatoryRequest.create({
        data: {
          employeeId,
          employmentId: employment.id,
          dayWorked: toDateOnly(input.dayWorked),
          dayOff: input.dayOff ? toDateOnly(input.dayOff) : null,
          reason: input.reason,
          status,
          outcome: byHr ? (input.outcome ?? 'day_off') : null,
          managerId,
          approverRole,
          recordedByHr: byHr,
          warnings,
          createdById: user.id,
          hoursWorked: input.hoursWorked,
          hoursOff: earned.kind === 'hours' ? earned.hours : null,
        },
        select: { id: true },
      });
      if (byHr) await this.step(tx, row.id, user.id, { kind: 'recorded_by_hr', comment: input.reason });
      else {
        await this.step(tx, row.id, user.id, { kind: 'submitted' });
        if (!managerId) await this.step(tx, row.id, null, { kind: 'no_manager' });
      }
      const cash = byHr && input.outcome === 'cash' ? await this.makeCash(tx, { id: row.id, employeeId, dayWorked: input.dayWorked }, cashDays, user.id) : null;
      return { id: row.id, warnings, cash };
    });
    await this.audit.record({
      userId: user.id,
      action: byHr ? 'record' : 'create',
      entityType: COMPENSATORY_ENTITY,
      entityId: made.id,
      diff: {
        employeeId,
        dayWorked: input.dayWorked,
        dayOff: input.dayOff,
        ...(input.hoursWorked !== null && { hoursWorked: input.hoursWorked, hoursOff: earned.kind === 'hours' ? earned.hours : null }),
        reason: input.reason,
        managerId,
        approverRole,
        status,
        ...(byHr && { outcome: input.outcome ?? 'day_off' }),
        ...(made.warnings.length && { warnings: made.warnings }),
      },
    });
    if (byHr) {
      if (made.cash) await this.auditCash(made.cash, made.id, user);
      await this.refill(employeeId, input.dayWorked, user, input.dayOff);
    }
    return made.id;
  }

  /**
   * Cash instead: the addition "Compensation for working <day>" on the draft payroll of the day worked's month, in days
   * (a Bonus (days), a day of the fixed part of the gross ÷ the run's day divisor: the payroll's own day-pay rule): the
   * Setup's rate for a whole day, its share for hours (compensatoryCashDays); linked to the request. Within the
   * decision's transaction.
   */
  private async makeCash(
    tx: Prisma.TransactionClient,
    request: { id: string; employeeId: string; dayWorked: string },
    rate: number,
    userId: string,
  ): Promise<{ adjustmentId: string; employeeCode: string; month: string; days: number; reason: string; employeeId: string }> {
    const month = compensatoryMonth(request.dayWorked);
    const reason = compensatoryCashReason(request.dayWorked);
    const adjustment = await tx.payrollAdjustment.create({
      data: {
        employeeId: request.employeeId,
        month: toDateOnly(firstDay(month)),
        kind: 'addition',
        type: 'bonus_days',
        // taxed, as pay (packages/shared payroll-adjustments.ts)
        taxed: adjustmentTaxed('addition', 'bonus_days', null) ?? true,
        days: rate,
        reason,
        createdById: userId,
      },
      select: { id: true, employee: { select: { employeeCode: true } } },
    });
    await tx.compensatoryRequest.update({ where: { id: request.id }, data: { adjustmentId: adjustment.id } });
    return { adjustmentId: adjustment.id, employeeCode: adjustment.employee.employeeCode, month, days: rate, reason, employeeId: request.employeeId };
  }

  /** The audit entry of the addition a cash decision made, and the month's draft payroll worked out with it. */
  private async auditCash(made: { adjustmentId: string; employeeCode: string; month: string; days: number; reason: string; employeeId: string }, requestId: string, user: SessionUser): Promise<void> {
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ADJUSTMENT,
      entityId: made.adjustmentId,
      // the amount is the run's to work out from the days
      diff: { employeeCode: made.employeeCode, month: made.month, kind: 'addition', type: 'bonus_days', taxed: true, days: made.days, reason: made.reason, compensatoryId: requestId },
    });
    await this.runs.syncDrafts([made.month], [made.employeeId], user);
  }

  /**
   * The day worked's month filled again on its draft payroll, and the day off's when it is another (the Setup's window):
   * the day off counts as attended, the day worked adds nothing.
   */
  private async refill(employeeId: string, dayWorked: string, user: SessionUser, dayOff: string | null = null): Promise<void> {
    await this.fill.fillMonth(employeeId, compensatoryMonth(dayWorked), user);
    if (dayOff && compensatoryMonth(dayOff) !== compensatoryMonth(dayWorked)) await this.fill.fillMonth(employeeId, compensatoryMonth(dayOff), user);
  }

  /** Logs a step on a request, in the transaction the step is taken in. */
  private async step(db: Db, requestId: string, actorId: string | null, step: { kind: string; decision?: string; comment?: string | null; onBehalfOf?: string | null }) {
    await db.compensatoryStep.create({ data: { requestId, actorId, kind: step.kind, decision: step.decision ?? null, comment: step.comment ?? null, onBehalfOfId: step.onBehalfOf ?? null } });
  }

  /** A request the caller may see; otherwise it isn't there. */
  private async visible(id: string, caller: Caller): Promise<CompensatoryRow> {
    const row = await this.prisma.compensatoryRequest.findUnique({ where: { id }, include: COMPENSATORY_INCLUDE });
    if (!row || !seesRequest(compensatoryParties(row), caller)) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** The requests as the caller sees them, with who took each step and whether the day worked has a check-in kept. */
  private async views(rows: readonly CompensatoryRow[], caller: Caller): Promise<CompensatoryRequestView[]> {
    if (!rows.length) return [];
    const shown = rows.filter((r) => !hiddenRequest(r, caller));
    const [names, days, punches, cashDays] = await Promise.all([
      userNames(
        this.prisma,
        rows.flatMap((r) => r.steps.map((s) => s.actor)),
      ),
      shown.length
        ? this.prisma.attendanceDay.findMany({ where: { employeeId: { in: [...new Set(shown.map((r) => r.employeeId))] }, date: { in: shown.map((r) => r.dayWorked) }, checkIn: { not: null } }, select: { employeeId: true, date: true } })
        : [],
      shown.length
        ? this.prisma.attendancePunch.findMany({ where: { employeeId: { in: [...new Set(shown.map((r) => r.employeeId))] }, date: { in: shown.map((r) => r.dayWorked) }, kind: 'in' }, select: { employeeId: true, date: true } })
        : [],
      this.cashRate(),
    ]);
    const checked = new Set([...days, ...punches].map((d) => `${d.employeeId}:${fromDateOnly(d.date)}`));
    return rows.map((r) =>
      compensatoryView(r, caller, names, { noCheckIn: hiddenRequest(r, caller) ? null : !checked.has(`${r.employeeId}:${fromDateOnly(r.dayWorked)}`), cashDays }),
    );
  }
}
