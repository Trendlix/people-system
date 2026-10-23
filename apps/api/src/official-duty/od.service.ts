import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_WORKING_DAYS,
  firstLeaveStatus,
  isOpenLeave,
  LEAVE_STATUS_LABELS,
  leaveDecisionNeedsComment,
  leaveDecisionStepKind,
  leaveStage,
  leaveStatusAfterApproval,
  OD_AFTER_DAYS,
  odDates,
  odRequestedAfter,
  odRequestProblems,
  type LeaveStatus,
  type OdDayFacts,
  type OdInput,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { AttendanceFillService } from '../attendance/attendance-fill.service.js';
import { addDays, fromDateOnly, shownDate, todayInCairo, toDateOnly, weekday } from '../common/date-only.js';
import { fromTimeOfDay, toTimeOfDay } from '../common/time-of-day.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  decidesStage,
  hrMayCancel,
  isConfidentialRequest,
  isHr,
  isRequestManager,
  isRequester,
  othersWhere,
  scopeWhere,
  seesRequest,
  waitingWhere,
  type Caller,
} from '../leave/access.js';
import type { DecideLeaveDto } from '../leave/leave.dto.js';
import { placeOf } from '../leave/views.js';
import { NoticesService } from '../notifications/notices.service.js';
import { approverFor } from '../organisation/departments/leads.js';
import { userNames } from '../payroll/adjustments/people.js';
import { lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateOdDto, HrCancelOdDto, ListOdDto, OdCalendarQueryDto } from './od.dto.js';
import { OD_ENTITY, OD_INCLUDE, OD_TYPE, odParties, odView, timeOf, type OdCalendarItem, type OdFormView, type OdRequestView, type OdRow } from './od-views.js';

type Db = PrismaService | Prisma.TransactionClient;
type Where = Prisma.OdRequestWhereInput;

const NOT_FOUND = 'Official duty request not found.';

/** Approved and being decided: what blocks the same days and hours for another request. */
const TAKING = ['with_manager', 'with_hr', 'approved'] as const;

/** A status as a message says it: "with HR", "approved". */
const statusWords = (status: string) => {
  const label = LEAVE_STATUS_LABELS[status as LeaveStatus] ?? status;
  return label[0].toLowerCase() + label.slice(1);
};

/** An employment as an official duty reads it: its dates, who is in charge, its type, the shift. */
const EMPLOYMENT = {
  id: true,
  employeeId: true,
  employmentType: true,
  joinDate: true,
  endDate: true,
  managerId: true,
  departmentId: true,
  shift: { select: { startTime: true, endTime: true, graceMinutes: true, workingDays: true } },
  employee: { select: { fullNameEn: true } },
} satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

/** The employment's shift as the shared rules read part of a day against it. */
const shiftOf = (e: EmploymentRow | null) =>
  e?.shift ? { startTime: fromTimeOfDay(e.shift.startTime), endTime: fromTimeOfDay(e.shift.endTime), graceMinutes: e.shift.graceMinutes } : null;

// Official duty, OD (owner, 23 October 2026: "Official duty (OD) requests. The plan has OD as a third attendance mode
// beside Office and WFH, needing an approved request"; packages/shared official-duty.ts). Work for the company away from
// the office, a working day, not leave. An employee asks from My Requests → Request official duty, for one day or several
// in a row (at most 31), a full day or part of one inside their shift, where and why; ahead, today, or up to 3 days after
// ("Ahead or up to 3 days after", Cairo), the latter marked requested after; never a single day that is an official
// holiday or a rest day of their shift, nor days with leave, a work from home day or another official duty on the same
// hours (approved or being decided), each refused with every reason, in a transaction holding the employee's row so two
// sent together can't both take the day. Under the employment its first day is in (not a freelancer, who doesn't check
// in), all its days within it. Decided as leave is ("Manager, then HR"; leave/access.ts): the approver in charge (the
// direct manager, else the team lead, else the department's head, never themself), then HR; nobody in charge: straight
// to HR; a C-level person's HR stage by the CEO, HR and their manager now not seeing it. The employee cancels theirs
// while it is being decided; HR cancels an approved one, saying why. Each step is logged on the request and in the audit
// log; the approver is told of a request waiting for them, the employee of their own decided (NoticesService). Once one
// is approved or an approved one is cancelled, the months of its days gone by are filled again on the draft payroll run
// (its days count as attended for its hours: attendance-days.service.ts).
@Injectable()
export class OdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
    private readonly fill: AttendanceFillService,
  ) {}

  // ---------- the employee's own ----------

  /** The caller's own requests, the latest first day first; none without an employee profile. */
  async mine(user: SessionUser): Promise<OdRequestView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.odRequest.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], include: OD_INCLUDE });
    return this.views(rows, caller);
  }

  /** What the request form reads first: today, the earliest first day, their shift, and why they can't ask. */
  async form(user: SessionUser): Promise<OdFormView> {
    const caller = await this.caller(user);
    const today = todayInCairo();
    const employment = caller.employeeId ? await this.employmentOn(caller.employeeId, today) : null;
    return {
      today,
      earliest: addDays(today, -OD_AFTER_DAYS),
      shift: shiftOf(employment),
      refusal: caller.employeeId ? this.refusalOf(employment) : 'Only someone with an employee profile can ask for an official duty: your sign-in has no employee profile.',
      toCeo: !!caller.employeeId && (caller.confidential?.all.has(caller.employeeId) ?? false),
    };
  }

  /** An employee's request for themself, under the employment its first day is in. */
  async create(dto: CreateOdDto, user: SessionUser): Promise<OdRequestView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Only an employee can ask for an official duty: your sign-in has no employee profile.');
    const employment = await this.employmentOn(caller.employeeId, dto.startDate);
    const refusal = this.refusalOf(employment);
    if (refusal || !employment) throw new BadRequestException([refusal ?? "You have no employment on that day, so you can't ask for an official duty."]);
    const id = await this.submit(employment, dto, caller);
    // to the one in charge of its first step, once it is saved
    await this.notices.od(id, 'sent');
    return this.one(id, user);
  }

  /** The employee cancels their own request while it is being decided (owner's brief, 23 October 2026: "cancel (before approval)"). */
  async cancelMine(id: string, user: SessionUser): Promise<OdRequestView> {
    const caller = await this.caller(user);
    const before = await this.prisma.odRequest.findUnique({ where: { id } });
    if (!before || !isRequester(before, caller)) throw new NotFoundException(NOT_FOUND);
    if (!isOpenLeave(before.status)) {
      throw new ConflictException(
        before.status === 'approved'
          ? 'This official duty is approved, so it can no longer be cancelled here. Ask HR to cancel it.'
          : `This request is ${statusWords(before.status)}, so it can't be cancelled.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.odRequest.updateMany({ where: { id, status: before.status }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException("This request was decided meanwhile, so it can't be cancelled. Reload the page to see where it is.");
      await this.step(tx, id, user.id, { kind: 'cancelled' });
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: OD_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, startDate: fromDateOnly(before.startDate), endDate: fromDateOnly(before.endDate), status: { from: before.status, to: 'cancelled' } },
    });
    return this.one(id, user);
  }

  // ---------- HR ----------

  /** HR cancels an approved official duty, saying why. Never HR's own; a C-level person's only HR who sees them. */
  async hrCancel(id: string, dto: HrCancelOdDto, user: SessionUser): Promise<OdRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = odParties(before);
    if (!isHr(user)) throw new ForbiddenException('Only HR cancels an approved official duty.');
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else in HR has to cancel your own official duty.');
    if (!hrMayCancel({ ...parties, status: before.status }, caller)) {
      throw new ConflictException(`This request is ${statusWords(before.status)}: HR cancels approved official duties only. ${isOpenLeave(before.status) ? 'Reject it instead.' : ''}`.trim());
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.odRequest.updateMany({ where: { id, status: 'approved' }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException('This request was cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: 'cancelled', comment: dto.comment });
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: OD_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, startDate: fromDateOnly(before.startDate), endDate: fromDateOnly(before.endDate), status: { from: 'approved', to: 'cancelled' }, comment: dto.comment },
    });
    await this.notices.od(id, 'cancelled_by_hr');
    // its days gone by are no longer attended for its hours
    await this.refill(before, user);
    return this.one(id, user);
  }

  // ---------- deciding and seeing them ----------

  /**
   * The requests the caller sees, the latest first day first: HR and the CEO everyone's (a C-level person's only the
   * CEO's and HR's with Super Admin, and the approver it was sent to); a manager or a lead those sent to them and their
   * team's. `waiting`: theirs to decide.
   */
  async list(query: ListOdDto, user: SessionUser): Promise<OdRequestView[]> {
    const caller = await this.caller(user);
    const rows = await this.prisma.odRequest.findMany({
      where: {
        AND: [
          othersWhere(caller) as Where,
          query.status === 'waiting' ? (waitingWhere(caller) as Where) : query.status ? { status: query.status } : {},
          query.employeeId ? { employeeId: query.employeeId } : {},
          query.departmentId ? { employment: { OR: [{ departmentId: query.departmentId }, { department: { parentId: query.departmentId } }] } } : {},
          query.from ? { endDate: { gte: toDateOnly(query.from) } } : {},
          query.to ? { startDate: { lte: toDateOnly(query.to) } } : {},
          query.late ? { late: query.late === 'true' } : {},
        ],
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      include: OD_INCLUDE,
    });
    return this.views(rows, caller);
  }

  /** { waiting }: how many wait for the caller's decision (the sidebar, Approvals and To Approve count them). */
  async counts(user: SessionUser): Promise<{ waiting: number }> {
    const caller = await this.caller(user);
    return { waiting: await this.prisma.odRequest.count({ where: waitingWhere(caller) as Where }) };
  }

  async one(id: string, user: SessionUser): Promise<OdRequestView> {
    const caller = await this.caller(user);
    return (await this.views([await this.visible(id, caller)], caller))[0];
  }

  /**
   * The decision of the stage the request is at, by its decider: the approver it was sent to, then HR (a C-level
   * person's: the CEO); never the employee's own. Approve moves it on (HR's approves it); reject, with a comment, ends it.
   */
  async decide(id: string, dto: DecideLeaveDto, user: SessionUser): Promise<OdRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = odParties(before);
    const stage = leaveStage(before.status);
    if (!stage) throw new ConflictException(`This request is ${statusWords(before.status)}, so there is nothing left to decide. Reload the page to see it.`);
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else has to decide your own official duty request.');
    if (!decidesStage(stage, parties, caller)) {
      if (isRequestManager(parties, caller) || decidesStage('hr', parties, caller)) {
        throw new ConflictException(`This request is ${statusWords(before.status)} now, so it isn't waiting for your decision. Reload the page to see where it is.`);
      }
      throw new ForbiddenException(
        isConfidentialRequest(parties, caller)
          ? "A C-level person's official duty request is decided by its approver, then the CEO."
          : "Only the request's approver and HR decide an official duty request.",
      );
    }
    const comment = dto.comment ?? null;
    if (leaveDecisionNeedsComment(dto.decision) && !comment) throw new BadRequestException('Write a comment: why the official duty is rejected.');
    const to: LeaveStatus = dto.decision === 'reject' ? 'rejected' : leaveStatusAfterApproval(stage);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.odRequest.updateMany({
        where: { id, status: before.status },
        data: to === 'rejected' ? { status: to, rejectedStage: stage, rejectReason: comment } : { status: to },
      });
      if (!count) throw new ConflictException('This request was decided or cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: leaveDecisionStepKind(stage), decision: dto.decision, comment });
    });
    await this.audit.record({
      userId: user.id,
      action: dto.decision === 'reject' ? 'reject' : 'approve',
      entityType: OD_ENTITY,
      entityId: id,
      diff: {
        employeeId: before.employeeId,
        startDate: fromDateOnly(before.startDate),
        endDate: fromDateOnly(before.endDate),
        stage,
        decision: dto.decision,
        status: { from: before.status, to },
        ...(comment && { comment }),
      },
    });
    // to the next step's decider, or the employee once it is approved or rejected
    await this.notices.od(id, 'decided');
    // approved: its days gone by count as attended for its hours on the month's draft payroll run
    if (to === 'approved') await this.refill(before, user);
    return this.one(id, user);
  }

  /**
   * The official duties on the leave calendar from `from` to `to` (its own colour on the web, owner's brief: "Team
   * calendar shows leave and OD"): approved, and for HR those being decided too, as far as the caller sees requests, by a
   * department and its teams.
   */
  async calendar(query: OdCalendarQueryDto, user: SessionUser): Promise<OdCalendarItem[]> {
    const caller = await this.caller(user);
    const today = todayInCairo();
    const from = query.from ?? `${today.slice(0, 7)}-01`;
    const to = query.to ?? lastDay(today.slice(0, 7));
    if (to < from) throw new BadRequestException(["The last day can't be before the first."]);
    if (Number(toDateOnly(to)) - Number(toDateOnly(from)) > 366 * 86_400_000) throw new BadRequestException(['Choose at most a year of days.']);
    const rows = await this.prisma.odRequest.findMany({
      where: {
        AND: [
          scopeWhere(caller) as Where,
          { status: { in: isHr(user) ? [...TAKING] : ['approved'] } },
          { startDate: { lte: toDateOnly(to) }, endDate: { gte: toDateOnly(from) } },
          query.departmentId ? { employment: { OR: [{ departmentId: query.departmentId }, { department: { parentId: query.departmentId } }] } } : {},
        ],
      },
      orderBy: [{ startDate: 'asc' }, { employee: { fullNameEn: 'asc' } }],
      select: {
        id: true,
        startDate: true,
        endDate: true,
        fullDay: true,
        fromTime: true,
        toTime: true,
        status: true,
        employee: { select: { id: true, fullNameEn: true } },
        employment: { select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: 'od' as const,
      employee: { id: r.employee.id, fullNameEn: r.employee.fullNameEn, ...placeOf(r.employment.department) },
      type: { id: OD_TYPE.id, nameEn: OD_TYPE.nameEn, nameAr: OD_TYPE.nameAr },
      startDate: fromDateOnly(r.startDate),
      endDate: fromDateOnly(r.endDate),
      halfDay: false as const,
      fullDay: r.fullDay,
      fromTime: timeOf(r.fromTime),
      toTime: timeOf(r.toTime),
      status: r.status as LeaveStatus,
    }));
  }

  // ---------- helpers ----------

  /** The caller, with their own employee profile and the C-level people. */
  async caller(user: SessionUser): Promise<Caller> {
    const [me, confidential] = await Promise.all([
      user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { id: true } }) : null,
      this.confidential.view(user),
    ]);
    return { user, employeeId: me?.id ?? null, confidential };
  }

  /** The employment a day is in, if any. */
  private employmentOn(employeeId: string, date: string): Promise<EmploymentRow | null> {
    return this.prisma.employment.findFirst({
      where: { employeeId, joinDate: { lte: toDateOnly(date) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(date) } }] },
      orderBy: { joinDate: 'desc' },
      select: EMPLOYMENT,
    });
  }

  /** Why someone can't ask for an official duty under an employment (null: they may): none, or a freelancer. */
  private refusalOf(employment: EmploymentRow | null): string | null {
    if (!employment) return "You have no current employment, so you can't ask for an official duty.";
    if (employment.employmentType === 'freelance') return 'You work freelance, outside the labour law and its working hours: no official duty is needed.';
    return null;
  }

  /** Each day of a request as the shared rules read it, for the person under `employment`; `except`: a request left out. */
  private async daysOf(db: Db, employment: EmploymentRow, dates: readonly string[], except?: string): Promise<OdDayFacts[]> {
    if (!dates.length) return [];
    const employeeId = employment.employeeId;
    const range = { gte: toDateOnly(dates[0]), lte: toDateOnly(dates[dates.length - 1]) };
    // one after another: in a transaction they share its one connection
    const holidays = await db.holiday.findMany({ where: { date: range }, select: { date: true, nameEn: true } });
    const leave = await db.leaveRequest.findMany({
      where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: range.lte }, endDate: { gte: range.gte } },
      orderBy: { startDate: 'asc' },
      select: { startDate: true, endDate: true, halfDay: true, status: true, type: { select: { nameEn: true } } },
    });
    const wfh = await db.wfhRequest.findMany({ where: { employeeId, status: { in: [...TAKING] }, date: range }, select: { date: true, status: true } });
    const ods = await db.odRequest.findMany({
      where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: range.lte }, endDate: { gte: range.gte }, ...(except && { id: { not: except } }) },
      select: { startDate: true, endDate: true, status: true, fullDay: true, fromTime: true, toTime: true },
    });
    const working = employment.shift?.workingDays ?? DEFAULT_WORKING_DAYS;
    const holidayOn = new Map(holidays.map((h) => [fromDateOnly(h.date), h.nameEn]));
    return dates.map((date) => {
      const l = leave.find((x) => fromDateOnly(x.startDate) <= date && date <= fromDateOnly(x.endDate));
      const w = wfh.find((x) => fromDateOnly(x.date) === date);
      return {
        date,
        workingDay: working.includes(weekday(date)),
        holiday: holidayOn.get(date) ?? null,
        leave: l ? { type: l.type.nameEn, status: statusWords(l.status), halfDay: l.halfDay } : null,
        wfh: w ? { status: statusWords(w.status) } : null,
        od: ods
          .filter((o) => fromDateOnly(o.startDate) <= date && date <= fromDateOnly(o.endDate))
          .map((o) => ({ status: statusWords(o.status), fullDay: o.fullDay, fromTime: timeOf(o.fromTime), toTime: timeOf(o.toTime) })),
      };
    });
  }

  /**
   * A request saved, checked in a transaction holding the employee's row: its shapes, the timing, the hours against the
   * shift, its days, and that they are all within the employment; sent to the approver in charge (or HR).
   */
  private async submit(employment: EmploymentRow, dto: CreateOdDto, caller: Caller): Promise<string> {
    const user = caller.user;
    const employeeId = employment.employeeId;
    const input: OdInput = {
      startDate: dto.startDate,
      endDate: dto.endDate ?? dto.startDate,
      fullDay: dto.fullDay !== false,
      fromTime: dto.fullDay === false ? (dto.fromTime ?? null) : null,
      toTime: dto.fullDay === false ? (dto.toTime ?? null) : null,
      place: dto.place,
      reason: dto.reason,
    };
    const inEmployment: string[] = [];
    const endDate = fromDateOnly(employment.endDate);
    if (endDate && input.endDate > endDate) inEmployment.push(`The official duty must be within the employment, which ended on ${shownDate(endDate)}.`);
    // the approver in charge (19 October 2026): the direct manager, else the team lead, else the department's head
    const approver = await approverFor(this.prisma, { employeeId, managerId: employment.managerId, departmentId: employment.departmentId });
    const managerId = approver?.employeeId ?? null;
    const approverRole = approver?.role ?? null;
    const status: LeaveStatus = firstLeaveStatus(managerId !== null);
    const today = todayInCairo();
    const late = odRequestedAfter(input.startDate, today);

    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const days = await this.daysOf(tx, employment, odDates(input.startDate, input.endDate));
      const problems = [...inEmployment, ...odRequestProblems(input, days, shiftOf(employment), today)];
      if (problems.length) throw new BadRequestException(problems);
      const row = await tx.odRequest.create({
        data: {
          employeeId,
          employmentId: employment.id,
          startDate: toDateOnly(input.startDate),
          endDate: toDateOnly(input.endDate),
          fullDay: input.fullDay,
          fromTime: input.fromTime ? toTimeOfDay(input.fromTime) : null,
          toTime: input.toTime ? toTimeOfDay(input.toTime) : null,
          place: input.place,
          reason: input.reason,
          late,
          status,
          managerId,
          approverRole,
          createdById: user.id,
        },
        select: { id: true },
      });
      await this.step(tx, row.id, user.id, { kind: 'submitted' });
      if (!managerId) await this.step(tx, row.id, null, { kind: 'no_manager' });
      return row.id;
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: OD_ENTITY,
      entityId: id,
      diff: {
        employeeId,
        startDate: input.startDate,
        endDate: input.endDate,
        fullDay: input.fullDay,
        ...(!input.fullDay && { fromTime: input.fromTime, toTime: input.toTime }),
        dutyPlace: input.place,
        reason: input.reason,
        late,
        managerId,
        approverRole,
        status,
      },
    });
    return id;
  }

  /** The months of a request's days up to today filled again on their draft payroll runs, once its days count differently. */
  private async refill(r: { employeeId: string; startDate: Date; endDate: Date }, user: SessionUser): Promise<void> {
    const today = todayInCairo();
    const months = new Set(odDates(fromDateOnly(r.startDate), fromDateOnly(r.endDate)).filter((d) => d <= today).map((d) => d.slice(0, 7)));
    for (const month of months) await this.fill.fillMonth(r.employeeId, month, user);
  }

  /** Logs a step on a request, in the transaction the step is taken in. */
  private async step(db: Db, requestId: string, actorId: string | null, step: { kind: string; decision?: string; comment?: string | null }) {
    await db.odRequestStep.create({ data: { requestId, actorId, kind: step.kind, decision: step.decision ?? null, comment: step.comment ?? null } });
  }

  /** A request the caller may see; otherwise it isn't there. */
  private async visible(id: string, caller: Caller): Promise<OdRow> {
    const row = await this.prisma.odRequest.findUnique({ where: { id }, include: OD_INCLUDE });
    if (!row || !seesRequest(odParties(row), caller)) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** The requests as the caller sees them, with who took each step. */
  private async views(rows: readonly OdRow[], caller: Caller): Promise<OdRequestView[]> {
    if (!rows.length) return [];
    const names = await userNames(
      this.prisma,
      rows.flatMap((r) => r.steps.map((s) => s.actor)),
    );
    return rows.map((r) => odView(r, caller, names));
  }
}
