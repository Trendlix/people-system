import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_WORKING_DAYS,
  expectedPlace,
  firstLeaveStatus,
  isOpenLeave,
  LEAVE_STATUS_LABELS,
  leaveDecisionNeedsComment,
  leaveDecisionStepKind,
  leaveStage,
  leaveStatusAfterApproval,
  nextWfhDay,
  wfhDayProblems,
  wfhLimitProblems,
  wfhMonth,
  wfhMonthUsed,
  wfhNotNeededMessage,
  wfhOffered,
  wfhRecordCheck,
  wfhRequestProblems,
  wfhRulesProblems,
  type LeaveStatus,
  type WfhDay,
  type WfhRules,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, isDateOnly, shownDate, todayInCairo, toDateOnly, weekday } from '../common/date-only.js';
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
import type { DecideLeaveDto } from '../leave/leave.dto.js';
import { placeOf, SETTINGS_ENTITY } from '../leave/views.js';
import { NoticesService } from '../notifications/notices.service.js';
import { approverFor } from '../organisation/departments/leads.js';
import { userNames } from '../payroll/adjustments/people.js';
import { firstDay, lastDay, monthsLater } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateWfhDto, HrCancelWfhDto, ListWfhDto, RecordWfhDto, UpdateWfhSettingsDto, WfhCalendarQueryDto, WfhCheckQueryDto } from './wfh.dto.js';
import { WFH_ENTITY, WFH_INCLUDE, WFH_TYPE, wfhParties, wfhRulesOf, wfhView, type WfhAllowanceView, type WfhCalendarItem, type WfhRequestView, type WfhRow } from './wfh-views.js';

type Db = PrismaService | Prisma.TransactionClient;
type Where = Prisma.WfhRequestWhereInput;

const NOT_FOUND = 'Work from home request not found.';

/** Approved and being decided: the days that count against the limits and block the same day for another. */
const TAKING = ['with_manager', 'with_hr', 'approved'] as const;

/** A status as a message says it: "with HR", "approved". */
const statusWords = (status: string) => {
  const label = LEAVE_STATUS_LABELS[status as LeaveStatus] ?? status;
  return label[0].toLowerCase() + label.slice(1);
};

/** The days around a day that the limits read: its month, and the gap either side (at most 31 days). */
const WINDOW_DAYS = 62;

/** How far ahead the request form looks for the next day possible. */
const NEXT_WITHIN_DAYS = 180;

/** An employment as working from home reads it: its dates, who is in charge, the arrangement, the shift's working days. */
const EMPLOYMENT = {
  id: true,
  employeeId: true,
  employmentType: true,
  joinDate: true,
  endDate: true,
  managerId: true,
  departmentId: true,
  workArrangement: true,
  officeDays: true,
  shift: { select: { workingDays: true } },
  employee: { select: { fullNameEn: true } },
} satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

/** One day of someone's history to bring over (Zoho People's "Working from home" rows): whose, the day, why. */
export interface WfhHistoryEntry {
  employeeId: string;
  /** YYYY-MM-DD. */
  date: string;
  reason?: string | null;
  /**
   * Pending in Zoho People (owner, 21 October 2026: Zoho's pending carried on in the system's own approval, as pending
   * leave is): a request at its first step, the approver in charge's (else HR's), instead of a day approved.
   */
  pending?: boolean;
  /** Its Zoho row's ZOHO_LINK_ID with the day (leave-import.ts wfhLinkKey), kept once only: brought over again, a duplicate. */
  zohoLinkId?: string | null;
}

/** How history is brought over. */
export interface WfhHistoryOptions {
  /**
   * The transaction to record in (the leave import's Apply), all or nothing with the rest of it. Its audit entries and
   * notices are then the caller's to send once it is committed: historyRecorded.
   */
  tx?: Prisma.TransactionClient;
  /** The leave import bringing the days over, which its Undo removes them with. */
  importId?: string | null;
  /** Said on each day's first step, e.g. "Imported from <file>". */
  comment?: string | null;
}

/** Leave not in the system yet that a preview reads as if it were (the leave import's own rows, applied with the days). */
export interface WfhPreviewLeave {
  employeeId: string;
  from: string;
  to: string;
  type: string;
  /** Its status's words, e.g. "approved". */
  status: string;
}

/** Why a day of history wasn't brought over. */
export type WfhHistorySkip = 'invalid_date' | 'not_found' | 'no_employment' | 'duplicate';

/**
 * What recordHistory did: each day recorded (approved, from Zoho People; or, pending there, a request at its first step),
 * with what it was recorded past (the limits, and a day that isn't a working office day of theirs: reported, never
 * refused), and each day left out, with why. A preview's ids are empty.
 */
export interface WfhHistoryResult {
  recorded: { employeeId: string; date: string; id: string; status: LeaveStatus; warnings: string[]; zohoLinkId: string | null }[];
  skipped: { employeeId: string; date: string; reason: WfhHistorySkip; message: string }[];
}

const UUID = /^[0-9a-f-]{36}$/i;

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"; in
// Zoho People it was a leave type; packages/shared wfh.ts). A working day in another place, not leave: no balance, no
// pay effect, the hours counted as any day's. An employee asks for one day at a time from My Requests → Work from home,
// under their current employment: someone expected at the office that day (an Office arrangement on a working day of
// their shift, a Hybrid one on its office days; Work from home, Outdoor and Indoor and outdoor never, nor a freelancer,
// who doesn't check in), never on an official holiday, a rest day or a day of their leave (approved or being decided);
// a day before at the latest ("A day before", Cairo); at most the Leave Setup's days a calendar month (2) and any two at
// least its days apart (7), across months, those approved and being decided counted ("its 2 days per month with a gap of
// 1 week between each record (Biweekly)"); each refused with every reason, in a transaction holding the employee's row
// so two sent together can't both take the last day. Decided as leave is ("Manager, then HR"; leave/access.ts): the
// approver in charge (the direct manager, else the team lead, else the department's head, never themself), then HR;
// nobody in charge: straight to HR; a C-level person's HR stage by the CEO, HR and their manager now not seeing it. The
// employee cancels theirs while it is being decided; HR cancels an approved one, saying why. HR records a day for
// someone on any day, past the notice and the limits too, with a reason and the warnings kept with it, approved at once
// and audited (never their own; a C-level person's only HR who sees them). Each step is logged on the request and in the
// audit log; the approver is told of a request waiting for them, the employee of their own decided (NoticesService).
// Zoho People's history comes in through recordHistory (for the leave import: owner, 21 October 2026, "Yes, as approved
// WFH days"), in the import's own transaction, duplicates skipped, the limits reported; previewHistory says the same
// for the import's review without saving anything.
@Injectable()
export class WfhService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
  ) {}

  // ---------- the employee's own ----------

  /** The caller's own requests, the latest day first; none without an employee profile. */
  async mine(user: SessionUser): Promise<WfhRequestView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.wfhRequest.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: WFH_INCLUDE });
    return this.views(rows, caller);
  }

  /**
   * The caller's month (this month in Cairo unless sent) as the request form shows it: the days taken of the month's,
   * their days around it for the live checks, and the next day they may ask for, from tomorrow (owner's brief: "x of 2
   * this month · next possible from DD/MM/YYYY").
   */
  async allowance(month: string | undefined, user: SessionUser): Promise<WfhAllowanceView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Your sign-in has no employee profile, so there are no work from home days.');
    const today = todayInCairo();
    const m = month ?? today.slice(0, 7);
    const tomorrow = addDays(today, 1);
    const employment = await this.currentEmployment(caller.employeeId);
    const rules = await this.rules();
    const from = [firstDay(monthsLater(m, -1)), addDays(tomorrow, -WINDOW_DAYS)].sort()[0];
    const to = [lastDay(monthsLater(m, 4)), addDays(tomorrow, NEXT_WITHIN_DAYS + WINDOW_DAYS)].sort().at(-1)!;
    const rows = await this.prisma.wfhRequest.findMany({
      where: { employeeId: caller.employeeId, status: { in: [...TAKING] }, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
      orderBy: { date: 'asc' },
      select: { date: true, status: true },
    });
    const taken = rows.map((r) => ({ date: fromDateOnly(r.date), status: r.status as LeaveStatus }));
    const inMonth = taken.filter((t) => wfhMonth(t.date) === m);
    const refusal = this.refusalOf(employment);
    const offered = !!employment && wfhOffered(employment.workArrangement, employment.officeDays);
    let nextPossible: string | null = null;
    if (!refusal && employment) {
      const until = addDays(tomorrow, NEXT_WITHIN_DAYS);
      const [holidays, leave] = await Promise.all([
        this.prisma.holiday.findMany({ where: { date: { gte: toDateOnly(tomorrow), lte: toDateOnly(until) } }, select: { date: true } }),
        this.prisma.leaveRequest.findMany({
          where: { employeeId: caller.employeeId, status: { in: [...TAKING] }, startDate: { lte: toDateOnly(until) }, endDate: { gte: toDateOnly(tomorrow) } },
          select: { startDate: true, endDate: true },
        }),
      ]);
      const holidaySet = new Set(holidays.map((h) => fromDateOnly(h.date)));
      const onLeave = (d: string) => leave.some((l) => fromDateOnly(l.startDate) <= d && d <= fromDateOnly(l.endDate));
      const working = employment.shift?.workingDays ?? DEFAULT_WORKING_DAYS;
      const workday = (d: string) =>
        working.includes(weekday(d)) &&
        expectedPlace(employment.workArrangement, employment.officeDays, weekday(d)) === 'office' &&
        !holidaySet.has(d) &&
        !onLeave(d) &&
        d >= fromDateOnly(employment.joinDate);
      nextPossible = nextWfhDay(
        tomorrow,
        rules,
        taken.map((t) => t.date),
        workday,
        NEXT_WITHIN_DAYS,
      );
    }
    return {
      month: m,
      daysPerMonth: rules.daysPerMonth,
      minGapDays: rules.minGapDays,
      used: inMonth.length,
      approved: inMonth.filter((t) => t.status === 'approved').length,
      pending: inMonth.filter((t) => t.status !== 'approved').length,
      taken,
      nextPossible,
      offered,
      refusal,
      today,
    };
  }

  /** An employee's request for themself, under their current employment. */
  async create(dto: CreateWfhDto, user: SessionUser): Promise<WfhRequestView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Only an employee can ask to work from home: your sign-in has no employee profile.');
    const employment = await this.currentEmployment(caller.employeeId);
    if (!employment) throw new ConflictException("You have no current employment, so you can't ask to work from home.");
    const id = await this.submit(employment, dto, caller, false);
    // to the one in charge of its first step, once it is saved
    await this.notices.wfh(id, 'sent');
    return this.one(id, user);
  }

  /** The employee cancels their own request while it is being decided (owner's brief, 21 October 2026). */
  async cancelMine(id: string, user: SessionUser): Promise<WfhRequestView> {
    const caller = await this.caller(user);
    const before = await this.prisma.wfhRequest.findUnique({ where: { id } });
    if (!before || !isRequester(before, caller)) throw new NotFoundException(NOT_FOUND);
    if (!isOpenLeave(before.status)) {
      throw new ConflictException(
        before.status === 'approved'
          ? 'This work from home day is approved, so it can no longer be cancelled here. Ask HR to cancel it.'
          : `This request is ${statusWords(before.status)}, so it can't be cancelled.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wfhRequest.updateMany({ where: { id, status: before.status }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException("This request was decided meanwhile, so it can't be cancelled. Reload the page to see where it is.");
      await this.step(tx, id, user.id, { kind: 'cancelled' });
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: WFH_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, date: fromDateOnly(before.date), status: { from: before.status, to: 'cancelled' } },
    });
    return this.one(id, user);
  }

  // ---------- HR on someone's behalf ----------

  /**
   * What HR recording a day for someone would meet (GET /wfh/check): what refuses it (the day itself) and what it would
   * be recorded past (no day's notice, the limits), under the employment the day is in.
   */
  async check(query: WfhCheckQueryDto, user: SessionUser): Promise<{ employee: { id: string; fullNameEn: string }; problems: string[]; warnings: string[]; used: number; daysPerMonth: number }> {
    const caller = await this.caller(user);
    const person = await this.prisma.employee.findUnique({ where: { id: query.employeeId }, select: { id: true, fullNameEn: true } });
    if (!person || caller.confidential?.hidden.has(query.employeeId)) throw new NotFoundException('Employee not found.');
    const rules = await this.rules();
    const employment = await this.employmentOn(query.employeeId, query.date);
    if (!employment) return { employee: person, problems: [`Choose a day within one of ${person.fullNameEn}'s employments.`], warnings: [], used: 0, daysPerMonth: rules.daysPerMonth };
    const refusal = this.refusalOf(employment, person.fullNameEn);
    const day = await this.dayOf(this.prisma, employment, query.date);
    const checked = refusal ? { problems: [refusal], warnings: [] } : wfhRecordCheck(query.date, rules, day, todayInCairo(), person.fullNameEn);
    return { employee: person, ...checked, used: wfhMonthUsed(wfhMonth(query.date), day.taken), daysPerMonth: rules.daysPerMonth };
  }

  /**
   * HR records a work from home day for someone (owner's brief, 21 October 2026: past, the same day or over the limit,
   * "with a warning and a reason"): approved at once, under the employment the day is in, the warnings kept with it and in
   * the audit log. Never HR's own.
   */
  async record(dto: RecordWfhDto, user: SessionUser): Promise<WfhRequestView> {
    const caller = await this.caller(user);
    if (!isHr(user)) throw new ForbiddenException('Only HR records a work from home day for someone.');
    if (caller.employeeId === dto.employeeId) throw new ForbiddenException('Someone else in HR has to record your own work from home day, or ask for it from My Requests.');
    const person = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { fullNameEn: true } });
    if (!person || caller.confidential?.hidden.has(dto.employeeId)) throw new NotFoundException('Employee not found.');
    const employment = await this.employmentOn(dto.employeeId, dto.date);
    if (!employment) throw new BadRequestException([`Choose a day within one of ${person.fullNameEn}'s employments.`]);
    const id = await this.submit(employment, dto, caller, true);
    return this.one(id, user);
  }

  /** HR cancels an approved day, saying why. Never HR's own; a C-level person's only HR who sees them. */
  async hrCancel(id: string, dto: HrCancelWfhDto, user: SessionUser): Promise<WfhRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = wfhParties(before);
    if (!isHr(user)) throw new ForbiddenException('Only HR cancels an approved work from home day.');
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else in HR has to cancel your own work from home day.');
    if (!hrMayCancel({ ...parties, status: before.status }, caller)) {
      throw new ConflictException(`This request is ${statusWords(before.status)}: HR cancels approved work from home days only. ${isOpenLeave(before.status) ? 'Reject it instead.' : ''}`.trim());
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wfhRequest.updateMany({ where: { id, status: 'approved' }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException('This request was cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: 'cancelled', comment: dto.comment });
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: WFH_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, date: fromDateOnly(before.date), status: { from: 'approved', to: 'cancelled' }, comment: dto.comment },
    });
    await this.notices.wfh(id, 'cancelled_by_hr');
    return this.one(id, user);
  }

  // ---------- deciding and seeing them ----------

  /**
   * The requests the caller sees, the latest day first: HR and the CEO everyone's (a C-level person's only the CEO's and
   * HR's with Super Admin, and the approver it was sent to); a manager or a lead those sent to them and their team's.
   * `waiting`: theirs to decide.
   */
  async list(query: ListWfhDto, user: SessionUser): Promise<WfhRequestView[]> {
    const caller = await this.caller(user);
    const rows = await this.prisma.wfhRequest.findMany({
      where: {
        AND: [
          othersWhere(caller) as Where,
          query.status === 'waiting' ? (waitingWhere(caller) as Where) : query.status ? { status: query.status } : {},
          query.employeeId ? { employeeId: query.employeeId } : {},
          query.departmentId ? { employment: { OR: [{ departmentId: query.departmentId }, { department: { parentId: query.departmentId } }] } } : {},
          query.source ? { source: query.source } : {},
          query.from ? { date: { gte: toDateOnly(query.from) } } : {},
          query.to ? { date: { lte: toDateOnly(query.to) } } : {},
        ],
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: WFH_INCLUDE,
    });
    return this.views(rows, caller);
  }

  /** { waiting }: how many wait for the caller's decision (the sidebar, Approvals and To Approve count them). */
  async counts(user: SessionUser): Promise<{ waiting: number }> {
    const caller = await this.caller(user);
    return { waiting: await this.prisma.wfhRequest.count({ where: waitingWhere(caller) as Where }) };
  }

  async one(id: string, user: SessionUser): Promise<WfhRequestView> {
    const caller = await this.caller(user);
    return (await this.views([await this.visible(id, caller)], caller))[0];
  }

  /**
   * The decision of the stage the request is at, by its decider: the approver it was sent to, then HR (a C-level
   * person's: the CEO); never the employee's own. Approve moves it on (HR's approves it); reject, with a comment, ends it.
   */
  async decide(id: string, dto: DecideLeaveDto, user: SessionUser): Promise<WfhRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = wfhParties(before);
    const stage = leaveStage(before.status);
    if (!stage) throw new ConflictException(`This request is ${statusWords(before.status)}, so there is nothing left to decide. Reload the page to see it.`);
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else has to decide your own work from home request.');
    // the approver it was sent to, away with a stand-in: theirs meanwhile (owner, 25 October 2026: "To a stand-in")
    const away = standInRefusal({ ...parties, status: before.status }, caller);
    if (away) throw new ConflictException(away);
    if (!decidesStage(stage, parties, caller)) {
      if (isRequestManager(parties, caller) || decidesStage('hr', parties, caller)) {
        throw new ConflictException(`This request is ${statusWords(before.status)} now, so it isn't waiting for your decision. Reload the page to see where it is.`);
      }
      throw new ForbiddenException(
        isConfidentialRequest(parties, caller)
          ? "A C-level person's work from home request is decided by its approver, then the CEO."
          : "Only the request's approver and HR decide a work from home request.",
      );
    }
    const comment = dto.comment ?? null;
    if (leaveDecisionNeedsComment(dto.decision) && !comment) throw new BadRequestException('Write a comment: why working from home is rejected.');
    const to: LeaveStatus = dto.decision === 'reject' ? 'rejected' : leaveStatusAfterApproval(stage);
    // a stand-in's decision keeps the approver they stood in for, on the step and in the audit log
    const onBehalfOf = decidedOnBehalfOf(stage, parties, caller);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wfhRequest.updateMany({
        where: { id, status: before.status },
        data: to === 'rejected' ? { status: to, rejectedStage: stage, rejectReason: comment } : { status: to },
      });
      if (!count) throw new ConflictException('This request was decided or cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: leaveDecisionStepKind(stage), decision: dto.decision, comment, onBehalfOf });
    });
    await this.audit.record({
      userId: user.id,
      action: dto.decision === 'reject' ? 'reject' : 'approve',
      entityType: WFH_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, date: fromDateOnly(before.date), stage, decision: dto.decision, status: { from: before.status, to }, ...(comment && { comment }), ...(onBehalfOf && { standingInFor: onBehalfOf }) },
    });
    // to the next step's decider, or the employee once it is approved or rejected
    await this.notices.wfh(id, 'decided');
    return this.one(id, user);
  }

  /**
   * The work from home days on the leave calendar from `from` to `to` (a distinct style from leave on the web): approved,
   * and for HR those being decided too, as far as the caller sees requests, by a department and its teams.
   */
  async calendar(query: WfhCalendarQueryDto, user: SessionUser): Promise<WfhCalendarItem[]> {
    const caller = await this.caller(user);
    const today = todayInCairo();
    const from = query.from ?? `${today.slice(0, 7)}-01`;
    const to = query.to ?? lastDay(today.slice(0, 7));
    if (to < from) throw new BadRequestException(["The last day can't be before the first."]);
    if (Number(toDateOnly(to)) - Number(toDateOnly(from)) > 366 * 86_400_000) throw new BadRequestException(['Choose at most a year of days.']);
    const rows = await this.prisma.wfhRequest.findMany({
      where: {
        AND: [
          scopeWhere(caller) as Where,
          { status: { in: isHr(user) ? [...TAKING] : ['approved'] } },
          { date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
          query.departmentId ? { employment: { OR: [{ departmentId: query.departmentId }, { department: { parentId: query.departmentId } }] } } : {},
        ],
      },
      orderBy: [{ date: 'asc' }, { employee: { fullNameEn: 'asc' } }],
      select: {
        id: true,
        date: true,
        status: true,
        employee: { select: { id: true, fullNameEn: true } },
        employment: { select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: 'wfh' as const,
      employee: { id: r.employee.id, fullNameEn: r.employee.fullNameEn, ...placeOf(r.employment.department) },
      type: { id: WFH_TYPE.id, nameEn: WFH_TYPE.nameEn, nameAr: WFH_TYPE.nameAr },
      startDate: fromDateOnly(r.date),
      endDate: fromDateOnly(r.date),
      halfDay: false as const,
      status: r.status as LeaveStatus,
    }));
  }

  // ---------- the Leave Setup's limits ----------

  /** The limits as Leave Setup shows them (anyone signed in reads them, as the Leave Setup's other numbers). */
  async settings(): Promise<WfhRules> {
    return this.rules();
  }

  /** HR changes the limits (Leave Setup), in the audit log as the Leave Setup's change. */
  async updateSettings(dto: UpdateWfhSettingsDto, user: SessionUser): Promise<WfhRules> {
    const before = await this.rules();
    const after: WfhRules = { daysPerMonth: dto.daysPerMonth ?? before.daysPerMonth, minGapDays: dto.minGapDays ?? before.minGapDays };
    const problems = wfhRulesProblems(after);
    if (problems.length) throw new BadRequestException(problems);
    await this.prisma.leaveSettings.upsert({
      where: { id: 1 },
      create: { id: 1, wfhDaysPerMonth: after.daysPerMonth, wfhMinGapDays: after.minGapDays, updatedById: user.id },
      update: { wfhDaysPerMonth: after.daysPerMonth, wfhMinGapDays: after.minGapDays, updatedById: user.id },
    });
    const diff = changes({ wfhDaysPerMonth: before.daysPerMonth, wfhMinGapDays: before.minGapDays }, { wfhDaysPerMonth: after.daysPerMonth, wfhMinGapDays: after.minGapDays });
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: SETTINGS_ENTITY, diff });
    return after;
  }

  // ---------- Zoho People's history ----------

  /**
   * Brings over days someone worked from home before the system (Zoho People's "Working from home" leave rows, mapped by
   * the leave import: owner, 21 October 2026, "Yes, as approved WFH days"): each recorded approved at once, source zoho,
   * under the employment the day is in, with a step "Imported from Zoho People" by `by.userId` and an audit entry; one
   * pending in Zoho (`pending`) as a request at its first step instead, the approver in charge's (else HR's), and told to
   * them, as pending leave imported is. The limits and the day's own rules are ignored for history but reported with
   * each (`warnings`, kept on the request too). Skipped, with why: a date that isn't one, a person not found, a day
   * outside their employments, and a duplicate (the same person and date already a day being decided or approved, its
   * ZOHO_LINK_ID and day brought over before, or twice in `entries`). Days are taken in date order by person, so the
   * limits read the earlier ones. Nobody is told of a day approved. All in one transaction holding each person's row:
   * the caller's when `options.tx` is given (the import's Apply), which then calls historyRecorded once it is committed.
   */
  async recordHistory(entries: readonly WfhHistoryEntry[], by: { userId: string }, options: WfhHistoryOptions = {}): Promise<WfhHistoryResult> {
    if (options.tx) return this.history(options.tx, entries, { ...options, userId: by.userId });
    if (!entries.length) return { recorded: [], skipped: [] };
    const result = await this.prisma.$transaction((tx) => this.history(tx, entries, { ...options, userId: by.userId }), { timeout: 60_000 });
    await this.historyRecorded(result, by, options);
    return result;
  }

  /** What recordHistory would do now, saving nothing (the leave import's review); `leave`: leave read as the people's too. */
  async previewHistory(entries: readonly WfhHistoryEntry[], leave: readonly WfhPreviewLeave[] = []): Promise<WfhHistoryResult> {
    return this.history(this.prisma, entries, { userId: null, leave });
  }

  /** Once history recorded in a transaction is committed: an audit entry for each day, and the pending ones told to their decider. */
  async historyRecorded(result: WfhHistoryResult, by: { userId: string }, options: Pick<WfhHistoryOptions, 'importId'> = {}): Promise<void> {
    const today = todayInCairo();
    for (const r of result.recorded) {
      await this.audit.record({
        userId: by.userId,
        action: 'import',
        entityType: WFH_ENTITY,
        entityId: r.id,
        diff: {
          employeeId: r.employeeId,
          date: r.date,
          source: 'zoho',
          status: r.status,
          ...(options.importId && { importId: options.importId }),
          ...(r.zohoLinkId && { zohoLinkId: r.zohoLinkId }),
          ...(r.warnings.length && { warnings: r.warnings }),
          ...(r.date >= today && { future: true }),
        },
      });
    }
    // a pending one, to the one in charge of its first step, as a request sent
    for (const r of result.recorded.filter((x) => x.status !== 'approved')) await this.notices.wfh(r.id, 'sent');
  }

  /**
   * History's days checked as recordHistory says, in date order by person, read in a few queries; saved when `userId` is
   * given (in `db`, a transaction, each person's row held first, as a request asked for is), else only said (a preview,
   * with `leave` read as the people's too).
   */
  private async history(
    db: Db,
    entries: readonly WfhHistoryEntry[],
    options: WfhHistoryOptions & { userId: string | null; leave?: readonly WfhPreviewLeave[] },
  ): Promise<WfhHistoryResult> {
    const result: WfhHistoryResult = { recorded: [], skipped: [] };
    if (!entries.length) return result;
    const userId = options.userId;
    const sorted = [...entries].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || String(a.date).localeCompare(String(b.date)));
    const ids = [...new Set(sorted.map((e) => e.employeeId).filter((id) => UUID.test(id)))].sort();
    const dates = sorted.map((e) => e.date).filter((d) => isDateOnly(d)).sort();
    const first = dates[0] ?? null;
    const last = dates[dates.length - 1] ?? null;
    const linkKeys = sorted.map((e) => e.zohoLinkId).filter((k): k is string => !!k);
    if (userId) for (const id of ids) await db.$queryRaw`SELECT 1 FROM employees WHERE id = ${id}::uuid FOR UPDATE`;
    const within = first !== null && last !== null && ids.length > 0;
    // one after another: in a transaction they share its one connection
    const rules = await this.rules(db);
    const people = ids.length ? await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullNameEn: true } }) : [];
    const employments = ids.length ? await db.employment.findMany({ where: { employeeId: { in: ids } }, orderBy: { joinDate: 'desc' }, select: EMPLOYMENT }) : [];
    const holidays = within ? await db.holiday.findMany({ where: { date: { gte: toDateOnly(first), lte: toDateOnly(last) } }, select: { date: true, nameEn: true } }) : [];
    const leave = within
      ? await db.leaveRequest.findMany({
          where: { employeeId: { in: ids }, status: { in: [...TAKING] }, startDate: { lte: toDateOnly(last) }, endDate: { gte: toDateOnly(first) } },
          orderBy: { startDate: 'asc' },
          select: { employeeId: true, startDate: true, endDate: true, status: true, type: { select: { nameEn: true } } },
        })
      : [];
    const taken = within
      ? await db.wfhRequest.findMany({
          where: { employeeId: { in: ids }, status: { in: [...TAKING] }, date: { gte: toDateOnly(addDays(first, -WINDOW_DAYS)), lte: toDateOnly(addDays(last, WINDOW_DAYS)) } },
          select: { employeeId: true, date: true },
        })
      : [];
    const linked = linkKeys.length ? await db.wfhRequest.findMany({ where: { zohoLinkId: { in: linkKeys } }, select: { zohoLinkId: true } }) : [];
    const nameOf = new Map(people.map((p) => [p.id, p.fullNameEn]));
    const holidayOn = new Map(holidays.map((h) => [fromDateOnly(h.date), h.nameEn]));
    const linkedKeys = new Set(linked.map((l) => l.zohoLinkId));
    const takenBy = new Map<string, string[]>();
    for (const t of taken) takenBy.set(t.employeeId, [...(takenBy.get(t.employeeId) ?? []), fromDateOnly(t.date)]);
    const leaveOn = (employeeId: string, date: string): WfhDay['leave'] => {
      const l = leave.find((x) => x.employeeId === employeeId && fromDateOnly(x.startDate) <= date && date <= fromDateOnly(x.endDate));
      if (l) return { type: l.type.nameEn, status: statusWords(l.status) };
      const p = options.leave?.find((x) => x.employeeId === employeeId && x.from <= date && date <= x.to);
      return p ? { type: p.type, status: p.status } : null;
    };
    const approvers = new Map<string, Awaited<ReturnType<typeof approverFor>>>();
    const seen = new Set<string>();

    for (const entry of sorted) {
      const { employeeId, date } = entry;
      const skip = (reason: WfhHistorySkip, message: string) => result.skipped.push({ employeeId, date, reason, message });
      if (!isDateOnly(date)) {
        skip('invalid_date', `${String(date)} isn't a date: write it as YYYY-MM-DD.`);
        continue;
      }
      const name = nameOf.get(employeeId);
      if (!name) {
        skip('not_found', 'Employee not found.');
        continue;
      }
      const key = `${employeeId}:${date}`;
      if (seen.has(key)) {
        skip('duplicate', `${name} has ${shownDate(date)} twice in this import: brought over once.`);
        continue;
      }
      seen.add(key);
      const employment = employments.find((e) => e.employeeId === employeeId && fromDateOnly(e.joinDate) <= date && (e.endDate === null || fromDateOnly(e.endDate) >= date));
      if (!employment) {
        skip('no_employment', `${shownDate(date)} isn't within one of ${name}'s employments.`);
        continue;
      }
      const mine = takenBy.get(employeeId) ?? [];
      takenBy.set(employeeId, mine);
      if (mine.includes(date)) {
        skip('duplicate', `${name} has a work from home day on ${shownDate(date)} already.`);
        continue;
      }
      if (entry.zohoLinkId && linkedKeys.has(entry.zohoLinkId)) {
        skip('duplicate', `${name}'s work from home day on ${shownDate(date)} was brought over from Zoho People before.`);
        continue;
      }
      const day: WfhDay = {
        arrangement: employment.workArrangement,
        officeDays: employment.officeDays,
        workingDay: (employment.shift?.workingDays ?? DEFAULT_WORKING_DAYS).includes(weekday(date)),
        holiday: holidayOn.get(date) ?? null,
        leave: leaveOn(employeeId, date),
        taken: [...mine],
      };
      // the day's own rules and the limits, reported for history, never refusing it (the notice is not history's)
      const warnings = [...wfhDayProblems(date, day, name), ...wfhLimitProblems(date, rules, day.taken, name)];
      // pending in Zoho: the approver in charge (19 October 2026), else straight to HR, as a request sent
      let approver: Awaited<ReturnType<typeof approverFor>> = null;
      if (entry.pending) {
        if (!approvers.has(employment.id)) approvers.set(employment.id, await approverFor(db, { employeeId, managerId: employment.managerId, departmentId: employment.departmentId }));
        approver = approvers.get(employment.id) ?? null;
      }
      const status: LeaveStatus = entry.pending ? firstLeaveStatus(approver !== null) : 'approved';
      let id = '';
      if (userId) {
        const row = await db.wfhRequest.create({
          data: {
            employeeId,
            employmentId: employment.id,
            date: toDateOnly(date),
            reason: entry.reason?.trim() || null,
            status,
            managerId: approver?.employeeId ?? null,
            approverRole: approver?.role ?? null,
            recordedByHr: !entry.pending,
            source: 'zoho',
            warnings,
            createdById: userId,
            importId: options.importId ?? null,
            zohoLinkId: entry.zohoLinkId ?? null,
          },
          select: { id: true },
        });
        id = row.id;
        if (entry.pending) {
          await this.step(db, id, userId, { kind: 'submitted', comment: `${options.comment ?? 'Imported from Zoho People'}: pending in Zoho People.` });
          if (!approver) await this.step(db, id, null, { kind: 'no_manager' });
        } else await this.step(db, id, userId, { kind: 'imported', comment: options.comment ?? null });
      }
      mine.push(date);
      if (entry.zohoLinkId) linkedKeys.add(entry.zohoLinkId);
      result.recorded.push({ employeeId, date, id, status, warnings, zohoLinkId: entry.zohoLinkId ?? null });
    }
    return result;
  }

  // ---------- helpers ----------

  /** The Leave Setup's limits (the migration's row; the owner's 2 and 7 should it be missing). */
  async rules(db: Db = this.prisma): Promise<WfhRules> {
    return wfhRulesOf(await db.leaveSettings.findUnique({ where: { id: 1 }, select: { wfhDaysPerMonth: true, wfhMinGapDays: true } }));
  }

  /** The caller, with their own employee profile and the C-level people. */
  async caller(user: SessionUser): Promise<Caller> {
    const [me, confidential] = await Promise.all([
      (user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { id: true } }) : null),
      this.confidential.view(user),
    ]);
    // whom they stand in for today, and their own stand-in while away (owner, 25 October 2026: "To a stand-in")
    return { user, employeeId: me?.id ?? null, confidential, standIn: await standInViewOf(this.prisma, me?.id ?? null, user) };
  }

  /** Someone's current employment, if any. */
  private currentEmployment(employeeId: string): Promise<EmploymentRow | null> {
    return this.prisma.employment.findFirst({ where: { employeeId, endDate: null }, orderBy: { joinDate: 'desc' }, select: EMPLOYMENT });
  }

  /** The employment a day is in, if any. */
  private employmentOn(employeeId: string, date: string): Promise<EmploymentRow | null> {
    return this.prisma.employment.findFirst({
      where: { employeeId, joinDate: { lte: toDateOnly(date) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(date) } }] },
      orderBy: { joinDate: 'desc' },
      select: EMPLOYMENT,
    });
  }

  /**
   * Why someone can't have a work from home day at all under an employment (null: they may): none; a freelancer (who
   * doesn't check in, outside the labour law's working hours); an arrangement that never expects them at the office.
   * `name`: theirs when HR records it.
   */
  private refusalOf(employment: EmploymentRow | null, name: string | null = null): string | null {
    if (!employment) return name ? `${name} has no current employment.` : "You have no current employment, so you can't ask to work from home.";
    if (employment.employmentType === 'freelance') {
      return `${name ? `${name} works` : 'You work'} freelance, outside the labour law and its working hours: no work from home day is needed.`;
    }
    if (!wfhOffered(employment.workArrangement, employment.officeDays)) return wfhNotNeededMessage(employment.workArrangement, name);
    return null;
  }

  /** The day as the shared rules read it, for the person under `employment`; `except`: a request left out. */
  private async dayOf(db: Db, employment: EmploymentRow, date: string, except?: string): Promise<WfhDay> {
    const employeeId = employment.employeeId;
    const [holiday, leave, taken] = await Promise.all([
      db.holiday.findUnique({ where: { date: toDateOnly(date) }, select: { nameEn: true } }),
      db.leaveRequest.findFirst({
        where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: toDateOnly(date) }, endDate: { gte: toDateOnly(date) } },
        orderBy: { startDate: 'asc' },
        select: { status: true, type: { select: { nameEn: true } } },
      }),
      db.wfhRequest.findMany({
        where: {
          employeeId,
          status: { in: [...TAKING] },
          date: { gte: toDateOnly(addDays(date, -WINDOW_DAYS)), lte: toDateOnly(addDays(date, WINDOW_DAYS)) },
          ...(except && { id: { not: except } }),
        },
        select: { date: true },
      }),
    ]);
    return {
      arrangement: employment.workArrangement,
      officeDays: employment.officeDays,
      workingDay: (employment.shift?.workingDays ?? DEFAULT_WORKING_DAYS).includes(weekday(date)),
      holiday: holiday?.nameEn ?? null,
      leave: leave ? { type: leave.type.nameEn, status: statusWords(leave.status) } : null,
      taken: taken.map((t) => fromDateOnly(t.date)),
    };
  }

  /**
   * A request saved, checked in a transaction holding the employee's row: an employee's against the day, the notice and
   * the limits, sent to the approver in charge (or HR); HR's against the day only, approved at once with what it was
   * recorded past.
   */
  private async submit(employment: EmploymentRow, dto: CreateWfhDto, caller: Caller, byHr: boolean): Promise<string> {
    const user = caller.user;
    const employeeId = employment.employeeId;
    const name = byHr ? employment.employee.fullNameEn : null;
    const refusal = this.refusalOf(employment, name);
    if (refusal) throw new BadRequestException([refusal]);
    const inEmployment: string[] = [];
    const joinDate = fromDateOnly(employment.joinDate);
    const endDate = fromDateOnly(employment.endDate);
    if (dto.date < joinDate) inEmployment.push(`The work from home day must be within the employment, which started on ${shownDate(joinDate)}.`);
    if (endDate && dto.date > endDate) inEmployment.push(`The work from home day must be within the employment, which ended on ${shownDate(endDate)}.`);
    // the approver in charge (19 October 2026): the direct manager, else the team lead, else the department's head
    const approver = await approverFor(this.prisma, { employeeId, managerId: employment.managerId, departmentId: employment.departmentId });
    const managerId = approver?.employeeId ?? null;
    const approverRole = approver?.role ?? null;
    const status: LeaveStatus = byHr ? 'approved' : firstLeaveStatus(managerId !== null);
    const today = todayInCairo();

    const made = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const [rules, day] = await Promise.all([this.rules(tx), this.dayOf(tx, employment, dto.date)]);
      let warnings: string[] = [];
      if (byHr) {
        const checked = wfhRecordCheck(dto.date, rules, day, today, employment.employee.fullNameEn);
        if (inEmployment.length || checked.problems.length) throw new BadRequestException([...inEmployment, ...checked.problems]);
        warnings = checked.warnings;
      } else {
        const problems = [...inEmployment, ...wfhRequestProblems(dto.date, rules, day, today)];
        if (problems.length) throw new BadRequestException(problems);
      }
      const row = await tx.wfhRequest.create({
        data: {
          employeeId,
          employmentId: employment.id,
          date: toDateOnly(dto.date),
          reason: dto.reason ?? null,
          status,
          managerId,
          approverRole,
          recordedByHr: byHr,
          warnings,
          createdById: user.id,
        },
        select: { id: true },
      });
      if (byHr) await this.step(tx, row.id, user.id, { kind: 'recorded_by_hr', comment: dto.reason ?? null });
      else {
        await this.step(tx, row.id, user.id, { kind: 'submitted' });
        if (!managerId) await this.step(tx, row.id, null, { kind: 'no_manager' });
      }
      return { id: row.id, warnings };
    });
    await this.audit.record({
      userId: user.id,
      action: byHr ? 'record' : 'create',
      entityType: WFH_ENTITY,
      entityId: made.id,
      diff: { employeeId, date: dto.date, reason: dto.reason ?? null, managerId, approverRole, status, ...(made.warnings.length && { warnings: made.warnings }) },
    });
    return made.id;
  }

  /** Logs a step on a request, in the transaction the step is taken in. */
  private async step(db: Db, requestId: string, actorId: string | null, step: { kind: string; decision?: string; comment?: string | null; onBehalfOf?: string | null }) {
    await db.wfhRequestStep.create({ data: { requestId, actorId, kind: step.kind, decision: step.decision ?? null, comment: step.comment ?? null, onBehalfOfId: step.onBehalfOf ?? null } });
  }

  /** A request the caller may see; otherwise it isn't there. */
  private async visible(id: string, caller: Caller): Promise<WfhRow> {
    const row = await this.prisma.wfhRequest.findUnique({ where: { id }, include: WFH_INCLUDE });
    if (!row || !seesRequest(wfhParties(row), caller)) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /**
   * The requests as the caller sees them, with who took each step and how many of each one's month's days its person has
   * taken (never a C-level person's to the approver a request was sent to, who sees their card only).
   */
  private async views(rows: readonly WfhRow[], caller: Caller): Promise<WfhRequestView[]> {
    if (!rows.length) return [];
    const keyOf = (employeeId: string, date: Date) => `${employeeId}:${wfhMonth(fromDateOnly(date))}`;
    const shown = rows.filter((r) => !hiddenRequest(r, caller));
    const days = shown.map((r) => fromDateOnly(r.date)).sort();
    const [names, taken] = await Promise.all([
      userNames(this.prisma, rows.flatMap((r) => r.steps.map((s) => s.actor))),
      shown.length
        ? this.prisma.wfhRequest.findMany({
            where: {
              employeeId: { in: [...new Set(shown.map((r) => r.employeeId))] },
              status: { in: [...TAKING] },
              date: { gte: toDateOnly(firstDay(days[0].slice(0, 7))), lte: toDateOnly(lastDay(days[days.length - 1].slice(0, 7))) },
            },
            select: { employeeId: true, date: true },
          })
        : [],
    ]);
    const used = new Map<string, number>();
    for (const t of taken) used.set(keyOf(t.employeeId, t.date), (used.get(keyOf(t.employeeId, t.date)) ?? 0) + 1);
    return rows.map((r) => wfhView(r, caller, names, hiddenRequest(r, caller) ? null : (used.get(keyOf(r.employeeId, r.date)) ?? 0)));
  }
}
