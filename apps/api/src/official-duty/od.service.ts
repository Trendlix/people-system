import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  alreadyOdText,
  compensatoryCashDays,
  DEFAULT_WORKING_DAYS,
  firstLeaveStatus,
  isOpenLeave,
  LEAVE_STATUS_LABELS,
  leaveDecisionNeedsComment,
  leaveDecisionStepKind,
  leaveStage,
  leaveStatusAfterApproval,
  OD_AFTER_DAYS,
  OD_IMPORT_PLACE,
  OD_MAX_DAYS,
  odDates,
  odDaysProblems,
  odEarned,
  odInputProblems,
  odNeedsCompensation,
  odPartHours,
  odOverlapsRowText,
  odOverlapsText,
  odRecordCheck,
  odRequestedAfter,
  odRequestProblems,
  odSameRowText,
  recordsOdFor,
  shiftWorkHours,
  type CompensationAsked,
  type CompensationEarned,
  type CompensatoryOutcome,
  type CompensatoryRules,
  type LeaveStatus,
  type OdDayFacts,
  type OdInput,
  type OdPayrollMonth,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { AttendanceFillService } from '../attendance/attendance-fill.service.js';
import { CompensatoryService, type OdCompensatoryFollowed, type OdCompensatoryMade } from '../compensatory/compensatory.service.js';
import { addDays, fromDateOnly, isDateOnly, shownDate, todayInCairo, toDateOnly, weekday } from '../common/date-only.js';
import { fromTimeOfDay, toTimeOfDay } from '../common/time-of-day.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  decidedOnBehalfOf,
  decidesStage,
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
import { placeOf } from '../leave/views.js';
import { NoticesService } from '../notifications/notices.service.js';
import { approverFor } from '../organisation/departments/leads.js';
import { userNames } from '../payroll/adjustments/people.js';
import { withWarnings } from '../payroll/locked-changes/locked-changes.js';
import { PayrollLockedChangesService } from '../payroll/locked-changes/locked-changes.service.js';
import { lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateOdDto, HrCancelOdDto, ListOdDto, OdCalendarQueryDto, OdCheckQueryDto, RecordOdDto } from './od.dto.js';
import { OD_ENTITY, OD_INCLUDE, OD_TYPE, odParties, odView, timeOf, type OdCalendarItem, type OdFormView, type OdRequestView, type OdRow } from './od-views.js';

type Db = PrismaService | Prisma.TransactionClient;
type Where = Prisma.OdRequestWhereInput;

const NOT_FOUND = 'Official duty request not found.';

/** Approved and being decided: what blocks the same days and hours for another request. */
const TAKING = ['with_manager', 'with_hr', 'approved'] as const;

/** A compensatory day off asked for and not paid in cash instead: what takes the day off (compensatory.service.ts). */
const TAKES_DAY_OFF: Prisma.CompensatoryRequestWhereInput = { OR: [{ outcome: null }, { outcome: { not: 'cash' } }] };

const UUID = /^[0-9a-f-]{36}$/i;

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
  shift: { select: { startTime: true, endTime: true, graceMinutes: true, workingDays: true, hoursPerDay: true } },
  employee: { select: { fullNameEn: true } },
} satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

/** The employment's shift as the shared rules read part of a day against it. */
const shiftOf = (e: EmploymentRow | null) =>
  e?.shift ? { startTime: fromTimeOfDay(e.shift.startTime), endTime: fromTimeOfDay(e.shift.endTime), graceMinutes: e.shift.graceMinutes } : null;

/** The shift's hours to work a day (null without a shift). */
const hoursADayOf = (e: EmploymentRow | null) =>
  e?.shift ? shiftWorkHours({ startTime: fromTimeOfDay(e.shift.startTime), endTime: fromTimeOfDay(e.shift.endTime), hoursPerDay: e.shift.hoursPerDay?.toNumber() ?? null }) : null;

/** The compensation sent with a request on a rest day or an official holiday (27 October 2026); null: none. */
const compensationOf = (dto: { compensation?: CompensatoryOutcome; dayOff?: string }): CompensationAsked | null =>
  dto.compensation ? { outcome: dto.compensation, dayOff: dto.compensation === 'cash' ? null : (dto.dayOff ?? null) } : null;

/** What HR's check and the request form say of a day off's compensation: needed, what it earns, cash instead, done already. */
export interface OdCompensationView {
  /** One day on a rest day or an official holiday. */
  onDayOff: boolean;
  /** A compensation is to be chosen with it: it earns one and no compensatory day compensates the day already. */
  needed: boolean;
  /** What its hours earn (null: not on a day off). */
  earned: CompensationEarned | null;
  /** Cash instead, in days' pay. */
  cashDays: number;
  /** A compensatory day compensates the day already: its status's words. */
  already: string | null;
}

/** What a person's days are read against: their holidays, leave, work from home days, compensatory days off and other official duties. */
interface DayRecords {
  holidays: ReadonlyMap<string, string>;
  leave: readonly { startDate: string; endDate: string; halfDay: boolean; status: string; type: string }[];
  wfh: readonly { date: string; status: string }[];
  compensatory: readonly { date: string; status: string }[];
  /** Days worked a compensatory day compensates already (27 October 2026); left out: none. */
  compensated?: readonly { date: string; status: string }[];
  od: readonly { startDate: string; endDate: string; status: string; fullDay: boolean; fromTime: string | null; toTime: string | null }[];
}

/** Each day of a request as the shared rules read it, under the shift's working days (dates YYYY-MM-DD, statuses in words). */
function dayFacts(working: readonly number[], dates: readonly string[], found: DayRecords): OdDayFacts[] {
  return dates.map((date) => {
    const l = found.leave.find((x) => x.startDate <= date && date <= x.endDate);
    const w = found.wfh.find((x) => x.date === date);
    const c = found.compensatory.find((x) => x.date === date);
    const done = found.compensated?.find((x) => x.date === date);
    return {
      date,
      workingDay: working.includes(weekday(date)),
      holiday: found.holidays.get(date) ?? null,
      leave: l ? { type: l.type, status: l.status, halfDay: l.halfDay } : null,
      wfh: w ? { status: w.status } : null,
      od: found.od.filter((o) => o.startDate <= date && date <= o.endDate).map((o) => ({ status: o.status, fullDay: o.fullDay, fromTime: o.fromTime, toTime: o.toTime })),
      compensatory: c ? { status: c.status } : null,
      compensated: done ? { status: done.status } : null,
    };
  });
}

/** One official duty of someone's history to bring over (a leave import's row): whose, its days (full days), why. */
export interface OdHistoryEntry {
  employeeId: string;
  /** YYYY-MM-DD, its first and last working day. */
  startDate: string;
  endDate: string;
  reason: string;
  /**
   * Pending in Zoho People (as working from home's are: wfh.service.ts): a request at its first step, the approver in
   * charge's (else HR's), instead of one approved.
   */
  pending?: boolean;
  /** Its Zoho row's ZOHO_LINK_ID, kept once only: brought over again, a duplicate. */
  zohoLinkId?: string | null;
  /** Its row in the file, for the messages. */
  row?: number | null;
}

/** How history is brought over. */
export interface OdHistoryOptions {
  /** The transaction to record in (the leave import's Apply); its audit entries and notices are then historyRecorded's. */
  tx?: Prisma.TransactionClient;
  /** The leave import bringing them over, which its Undo removes them with. */
  importId?: string | null;
  /** Said on each one's first step, e.g. "Imported from <file>". */
  comment?: string | null;
}

/** What a preview reads as the people's too: the importing file's own leave and work-from-home days, applied with them. */
export interface OdPreviewOthers {
  leave?: readonly { employeeId: string; from: string; to: string; type: string; status: string }[];
  wfh?: readonly { employeeId: string; date: string; status: string }[];
}

/** Why an official duty of history wasn't brought over. */
export type OdHistorySkip = 'invalid_date' | 'not_found' | 'no_employment' | 'duplicate' | 'overlap';

/**
 * What recordHistory did: each official duty recorded (approved; or, pending in Zoho, a request at its first step), with
 * what its days met (leave, a work from home day, a compensatory day off: reported, never refused, as history), and each
 * left out, with why. A preview's ids are empty.
 */
export interface OdHistoryResult {
  recorded: { employeeId: string; startDate: string; endDate: string; id: string; status: LeaveStatus; warnings: string[]; zohoLinkId: string | null; row: number | null }[];
  skipped: { employeeId: string; startDate: string; endDate: string; reason: OdHistorySkip; message: string; row: number | null }[];
}

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
// (its days count as attended for its hours: attendance-days.service.ts). Asked "how to apply or import official duty"
// (owner, 26 October 2026), he chose "HR records it" and "Import (template + Zoho)": HR records one for someone as HR
// records a work from home day (wfh.service.ts record): approved at once with a "recorded by HR" step, past the 3-day
// limit too (marked with the warning, the reason required as every official duty's is), the warnings shown first
// (GET /official-duty/check); the rest of the checks hold, and a month whose payroll is with the CEO, approved or paid is
// refused. Never HR's own; a C-level person's only by those who see them, the CEO too (recordsOdFor). The employee is
// told, the months' drafts refill, all audited; HR's cancel works on it. The leave import's official duty rows come in
// through recordHistory, as working from home's do (WfhService.recordHistory): in the import's own transaction,
// duplicates and overlaps skipped, what the days meet reported; previewHistory says the same for its review.
@Injectable()
export class OdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
    private readonly fill: AttendanceFillService,
    private readonly lockedChanges: PayrollLockedChangesService,
    private readonly compensatory: CompensatoryService,
  ) {}

  // ---------- the employee's own ----------

  /** The caller's own requests, the latest first day first; none without an employee profile. */
  async mine(user: SessionUser): Promise<OdRequestView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.odRequest.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], include: OD_INCLUDE });
    return this.views(rows, caller);
  }

  /**
   * What the request form reads first: today, the earliest first day, their shift, why they can't ask; and, for one on a
   * rest day or an official holiday (27 October 2026), their working days, the official holidays of the year ahead, the
   * Compensatory Setup and the shift's hours a day, to show its compensation as the day is chosen.
   */
  async form(user: SessionUser): Promise<OdFormView> {
    const caller = await this.caller(user);
    const today = todayInCairo();
    const employment = caller.employeeId ? await this.employmentOn(caller.employeeId, today) : null;
    const earliest = addDays(today, -OD_AFTER_DAYS);
    const [holidays, rules] = await Promise.all([
      this.prisma.holiday.findMany({ where: { date: { gte: toDateOnly(earliest), lte: toDateOnly(addDays(today, 366)) } }, select: { date: true, nameEn: true }, orderBy: { date: 'asc' } }),
      this.compensatory.rules(),
    ]);
    return {
      today,
      earliest,
      shift: shiftOf(employment),
      refusal: caller.employeeId ? this.refusalOf(employment) : 'Only someone with an employee profile can ask for an official duty: your sign-in has no employee profile.',
      toCeo: !!caller.employeeId && (caller.confidential?.all.has(caller.employeeId) ?? false),
      workingDays: [...(employment?.shift?.workingDays ?? DEFAULT_WORKING_DAYS)],
      holidays: holidays.map((h) => ({ date: fromDateOnly(h.date)!, nameEn: h.nameEn })),
      rules,
      hoursADay: hoursADayOf(employment),
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
    // its compensatory day (27 October 2026) is cancelled with it
    const linked = await this.compensatory.ofOd(this.prisma, id);
    const followed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.odRequest.updateMany({ where: { id, status: before.status }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException("This request was decided meanwhile, so it can't be cancelled. Reload the page to see where it is.");
      await this.step(tx, id, user.id, { kind: 'cancelled' });
      return linked ? await this.compensatory.followOd(tx, linked, { to: 'cancelled', stage: null, comment: null }, user.id) : null;
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: OD_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, startDate: fromDateOnly(before.startDate), endDate: fromDateOnly(before.endDate), status: { from: before.status, to: 'cancelled' } },
    });
    if (linked && followed) await this.compensatory.followedOd(linked, followed, id, user);
    return this.one(id, user);
  }

  // ---------- HR ----------

  /**
   * What HR recording official duty for someone would meet (GET /official-duty/check): what refuses it (the days, the
   * hours, a month whose payroll is with the CEO, approved or paid) and what it would be recorded past (the 3-day limit),
   * under the employment its first day is in, with the person's shift for part of a day.
   */
  async check(
    query: OdCheckQueryDto,
    user: SessionUser,
  ): Promise<{ employee: { id: string; fullNameEn: string }; problems: string[]; warnings: string[]; shift: ReturnType<typeof shiftOf>; compensation: OdCompensationView }> {
    const caller = await this.caller(user);
    const person = await this.recordable(query.employeeId, caller);
    const input = this.inputOf(query);
    const none: OdCompensationView = { onDayOff: false, needed: false, earned: null, cashDays: 0, already: null };
    const employment = await this.employmentOn(query.employeeId, query.startDate);
    if (!employment) return { employee: person, problems: [`Choose days within one of ${person.fullNameEn}'s employments.`], warnings: [], shift: null, compensation: none };
    const refusal = this.refusalOf(employment, person.fullNameEn);
    if (refusal) return { employee: person, problems: [refusal], warnings: [], shift: shiftOf(employment), compensation: none };
    const today = todayInCairo();
    const rules = await this.compensatory.rules();
    const asked = compensationOf(query);
    const days = await this.daysOf(this.prisma, employment, odDates(input.startDate, input.endDate));
    const checked = odRecordCheck(input, days, shiftOf(employment), today, person.fullNameEn, await this.payrollMonths(this.prisma, input), asked, rules);
    // on a rest day or an official holiday (27 October 2026): what it earns, and what its compensation meets
    const compensation = this.compensationView(input, days, rules, employment);
    const comp = asked && compensation.needed ? await this.compensatory.odCheck(this.prisma, employment, input.startDate, asked, today, person.fullNameEn) : { problems: [], warnings: [] };
    return {
      employee: person,
      problems: [...this.inEmployment(employment, input), ...checked.problems, ...comp.problems],
      warnings: [...checked.warnings, ...comp.warnings],
      shift: shiftOf(employment),
      compensation,
    };
  }

  /**
   * HR records an official duty for someone (owner, 26 October 2026: "HR records it"): approved at once with a "recorded
   * by HR" step, past the 3-day limit too (the warning kept with it and in the audit log), under the employment its first
   * day is in. The employee is told, the months of its days gone by are filled again on the draft payroll. Never HR's
   * own; a C-level person's by the CEO, or HR who sees them.
   */
  async record(dto: RecordOdDto, user: SessionUser): Promise<OdRequestView> {
    const caller = await this.caller(user);
    const person = await this.recordable(dto.employeeId, caller);
    const employment = await this.employmentOn(dto.employeeId, dto.startDate);
    if (!employment) throw new BadRequestException([`Choose days within one of ${person.fullNameEn}'s employments.`]);
    const refusal = this.refusalOf(employment, person.fullNameEn);
    if (refusal) throw new BadRequestException([refusal]);
    const id = await this.submit(employment, dto, caller, true);
    await this.notices.od(id, 'recorded_by_hr');
    // its days gone by count as attended for its hours on the months' draft payroll runs
    const input = this.inputOf(dto);
    await this.refill({ employeeId: dto.employeeId, startDate: toDateOnly(input.startDate), endDate: toDateOnly(input.endDate) }, user);
    return this.one(id, user);
  }

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
    // its compensatory day (27 October 2026) is cancelled with it, a pending cash addition too
    const linked = await this.compensatory.ofOd(this.prisma, id);
    const followed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.odRequest.updateMany({ where: { id, status: 'approved' }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException('This request was cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: 'cancelled', comment: dto.comment });
      return linked ? await this.compensatory.followOd(tx, linked, { to: 'cancelled', stage: null, comment: dto.comment }, user.id) : null;
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: OD_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, startDate: fromDateOnly(before.startDate), endDate: fromDateOnly(before.endDate), status: { from: 'approved', to: 'cancelled' }, comment: dto.comment },
    });
    if (linked && followed) await this.compensatory.followedOd(linked, followed, id, user);
    await this.notices.od(id, 'cancelled_by_hr');
    // its days gone by are no longer attended for its hours
    await this.refill(before, user);
    // cancelled in a month whose payroll has moved on: flagged, never silent (owner's brief, 27 October 2026)
    const warnings = await this.lockedChanges.flag({ employeeId: before.employeeId, kind: 'od', requestId: id, change: 'cancelled', from: fromDateOnly(before.startDate), to: fromDateOnly(before.endDate) }, user);
    return withWarnings(await this.one(id, user), warnings);
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
    // the approver it was sent to, away with a stand-in: theirs meanwhile (owner, 25 October 2026: "To a stand-in")
    const away = standInRefusal({ ...parties, status: before.status }, caller);
    if (away) throw new ConflictException(away);
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
    // a stand-in's decision keeps the approver they stood in for, on the step and in the audit log
    const onBehalfOf = decidedOnBehalfOf(stage, parties, caller);
    // its compensatory day (27 October 2026) takes the same step; approving it, its months open and its day off still free
    const linked = await this.compensatory.ofOd(this.prisma, id);
    if (linked && to === 'approved') await this.compensatory.assertOdApprovable(linked, before.employee.fullNameEn);
    const followed: OdCompensatoryFollowed | null = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.odRequest.updateMany({
        where: { id, status: before.status },
        data: to === 'rejected' ? { status: to, rejectedStage: stage, rejectReason: comment } : { status: to },
      });
      if (!count) throw new ConflictException('This request was decided or cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: leaveDecisionStepKind(stage), decision: dto.decision, comment, onBehalfOf });
      return linked ? await this.compensatory.followOd(tx, linked, { to, stage, decision: dto.decision, comment, onBehalfOf }, user.id) : null;
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
        ...(comment && { comment }), ...(onBehalfOf && { standingInFor: onBehalfOf }),
      },
    });
    if (linked && followed) await this.compensatory.followedOd(linked, followed, id, user);
    // to the next step's decider, or the employee once it is approved or rejected
    await this.notices.od(id, 'decided');
    // approved: its days gone by count as attended for its hours on the month's draft payroll run
    if (to === 'approved') await this.refill(before, user);
    // approved in a month whose payroll has moved on (recording in one is refused, odLockProblem): flagged, never silent (27 October 2026)
    const warnings =
      to === 'approved'
        ? await this.lockedChanges.flag({ employeeId: before.employeeId, kind: 'od', requestId: id, change: 'approved', from: fromDateOnly(before.startDate), to: fromDateOnly(before.endDate) }, user)
        : [];
    return withWarnings(await this.one(id, user), warnings);
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

  // ---------- history: the leave import's official duty rows ----------

  /**
   * Brings official duty over from a leave import (owner, 26 October 2026: "Import (template + Zoho)"): each entry one
   * official duty of full days, approved at once with an "imported" step by `by.userId` (recorded by HR, the place
   * "Imported", its reason the row's), or, pending in Zoho (`pending`), a request at its first step, the approver in
   * charge's (else HR's), told to them, as working from home's history is (WfhService.recordHistory). Not asked after its
   * day (history isn't "requested after"). What its days meet (leave, a work from home day, a compensatory day off, a
   * single rest day or holiday) is reported with it (`warnings`, kept on the request too), never refusing it. Skipped,
   * with why: days that aren't an official duty's (YYYY-MM-DD, at most 31 in a row), a person not found, days outside
   * one of their employments (or a freelancer's), a duplicate (its ZOHO_LINK_ID brought over before, the same days as an
   * official duty of theirs being decided or approved, or as an earlier entry), and an overlap with either. All in one
   * transaction holding each person's row: the caller's when `options.tx` is given (the import's Apply), which then calls
   * historyRecorded once it is committed.
   */
  async recordHistory(entries: readonly OdHistoryEntry[], by: { userId: string }, options: OdHistoryOptions = {}): Promise<OdHistoryResult> {
    if (options.tx) return this.history(options.tx, entries, { ...options, userId: by.userId });
    if (!entries.length) return { recorded: [], skipped: [] };
    const result = await this.prisma.$transaction((tx) => this.history(tx, entries, { ...options, userId: by.userId }), { timeout: 60_000 });
    await this.historyRecorded(result, by, options);
    return result;
  }

  /** What recordHistory would do now, saving nothing (the leave import's review); `others`: the file's own leave and work from home days too. */
  async previewHistory(entries: readonly OdHistoryEntry[], others: OdPreviewOthers = {}): Promise<OdHistoryResult> {
    return this.history(this.prisma, entries, { userId: null, ...others });
  }

  /**
   * Once history recorded in a transaction is committed: an audit entry for each, the pending ones told to their decider,
   * and the months of the approved ones' days gone by filled again on the draft payroll runs (their days count as
   * attended).
   */
  async historyRecorded(result: OdHistoryResult, by: { userId: string }, options: Pick<OdHistoryOptions, 'importId'> = {}): Promise<void> {
    const today = todayInCairo();
    for (const r of result.recorded) {
      await this.audit.record({
        userId: by.userId,
        action: 'import',
        entityType: OD_ENTITY,
        entityId: r.id,
        diff: {
          employeeId: r.employeeId,
          startDate: r.startDate,
          endDate: r.endDate,
          fullDay: true,
          dutyPlace: OD_IMPORT_PLACE,
          status: r.status,
          ...(options.importId && { importId: options.importId }),
          ...(r.zohoLinkId && { zohoLinkId: r.zohoLinkId }),
          ...(r.warnings.length && { warnings: r.warnings }),
          ...(r.startDate >= today && { future: true }),
        },
      });
    }
    for (const r of result.recorded.filter((x) => x.status !== 'approved')) await this.notices.od(r.id, 'sent');
    const approved = result.recorded.filter((x) => x.status === 'approved');
    for (const employeeId of new Set(approved.map((r) => r.employeeId))) {
      await this.refillDays(employeeId, approved.filter((r) => r.employeeId === employeeId), { id: by.userId } as SessionUser);
    }
  }

  /**
   * Once a leave import's Undo has removed official duties it made (in its own transaction): an audit entry for each,
   * and the months of the approved ones' days gone by filled again (their days are expected as usual again).
   */
  async historyUndone(
    removed: readonly { id: string; employeeId: string; startDate: Date; endDate: Date; status: string; zohoLinkId: string | null }[],
    by: { userId: string },
    importId: string,
  ): Promise<void> {
    for (const r of removed) {
      await this.audit.record({
        userId: by.userId,
        action: 'delete',
        entityType: OD_ENTITY,
        entityId: r.id,
        diff: {
          employeeId: r.employeeId,
          startDate: fromDateOnly(r.startDate),
          endDate: fromDateOnly(r.endDate),
          status: r.status,
          importId,
          ...(r.zohoLinkId && { zohoLinkId: r.zohoLinkId }),
          undone: true,
        },
      });
    }
    const approved = removed.filter((r) => r.status === 'approved');
    for (const employeeId of new Set(approved.map((r) => r.employeeId))) {
      const theirs = approved.filter((r) => r.employeeId === employeeId).map((r) => ({ startDate: fromDateOnly(r.startDate), endDate: fromDateOnly(r.endDate) }));
      await this.refillDays(employeeId, theirs, { id: by.userId } as SessionUser);
    }
  }

  /**
   * History's official duties checked as recordHistory says, in the order given, read in a few queries; saved when
   * `userId` is given (in `db`, a transaction, each person's row held first), else only said (a preview, with the file's
   * own leave and work from home days read as the people's too).
   */
  private async history(db: Db, entries: readonly OdHistoryEntry[], options: OdHistoryOptions & OdPreviewOthers & { userId: string | null }): Promise<OdHistoryResult> {
    const result: OdHistoryResult = { recorded: [], skipped: [] };
    if (!entries.length) return result;
    const userId = options.userId;
    const readable = (e: OdHistoryEntry) =>
      isDateOnly(e.startDate) && isDateOnly(e.endDate) && e.endDate >= e.startDate && odDates(e.startDate, e.endDate).length <= OD_MAX_DAYS;
    const ids = [...new Set(entries.map((e) => e.employeeId).filter((id) => UUID.test(id)))].sort();
    const dates = entries
      .filter(readable)
      .flatMap((e) => [e.startDate, e.endDate])
      .sort();
    const linkKeys = entries.map((e) => e.zohoLinkId).filter((k): k is string => !!k);
    if (userId) for (const id of ids) await db.$queryRaw`SELECT 1 FROM employees WHERE id = ${id}::uuid FOR UPDATE`;
    const range = dates.length && ids.length ? { gte: toDateOnly(dates[0]), lte: toDateOnly(dates[dates.length - 1]) } : null;
    const inIds = { in: ids };
    const taking = { in: [...TAKING] };
    // one after another: in a transaction they share its one connection
    const people = ids.length ? await db.employee.findMany({ where: { id: inIds }, select: { id: true, fullNameEn: true } }) : [];
    const employments = ids.length ? await db.employment.findMany({ where: { employeeId: inIds }, orderBy: { joinDate: 'desc' }, select: EMPLOYMENT }) : [];
    const holidays = range ? await db.holiday.findMany({ where: { date: range }, select: { date: true, nameEn: true } }) : [];
    const leave = range
      ? await db.leaveRequest.findMany({
          where: { employeeId: inIds, status: taking, startDate: { lte: range.lte }, endDate: { gte: range.gte } },
          orderBy: { startDate: 'asc' },
          select: { employeeId: true, startDate: true, endDate: true, halfDay: true, status: true, type: { select: { nameEn: true } } },
        })
      : [];
    const wfh = range ? await db.wfhRequest.findMany({ where: { employeeId: inIds, status: taking, date: range }, select: { employeeId: true, date: true, status: true } }) : [];
    const comp = range
      ? await db.compensatoryRequest.findMany({ where: { employeeId: inIds, status: taking, dayOff: range, AND: [TAKES_DAY_OFF] }, select: { employeeId: true, dayOff: true, status: true } })
      : [];
    const ods = range
      ? await db.odRequest.findMany({
          where: { employeeId: inIds, status: taking, startDate: { lte: range.lte }, endDate: { gte: range.gte } },
          select: { employeeId: true, startDate: true, endDate: true, status: true, importId: true },
        })
      : [];
    const linked = linkKeys.length ? await db.odRequest.findMany({ where: { zohoLinkId: { in: linkKeys } }, select: { zohoLinkId: true, startDate: true, endDate: true, status: true, importId: true } }) : [];
    const fileIds = [...new Set([...ods, ...linked].map((o) => o.importId).filter((x): x is string => !!x))];
    const files = new Map((fileIds.length ? await db.leaveImport.findMany({ where: { id: { in: fileIds } }, select: { id: true, fileName: true } }) : []).map((f) => [f.id, f.fileName]));
    /** An official duty there already, in words: its status, or the file it was imported from. */
    const how = (o: { status: string; importId: string | null }) => {
      const file = o.importId ? files.get(o.importId) : undefined;
      return file ? `imported from ${file}${o.status === 'approved' ? '' : `, ${statusWords(o.status)}`}` : statusWords(o.status);
    };
    const nameOf = new Map(people.map((p) => [p.id, p.fullNameEn]));
    const holidayOn = new Map(holidays.map((h) => [fromDateOnly(h.date), h.nameEn]));
    const linkedKeys = new Set(linked.map((l) => l.zohoLinkId));
    const there = ods.map((o) => ({ employeeId: o.employeeId, startDate: fromDateOnly(o.startDate), endDate: fromDateOnly(o.endDate), status: o.status, importId: o.importId }));
    const approvers = new Map<string, Awaited<ReturnType<typeof approverFor>>>();
    const made: { employeeId: string; startDate: string; endDate: string; row: number | null }[] = [];

    for (const entry of entries) {
      const { employeeId, startDate, endDate } = entry;
      const row = entry.row ?? null;
      const skip = (reason: OdHistorySkip, message: string) => result.skipped.push({ employeeId, startDate, endDate, reason, message, row });
      if (!readable(entry)) {
        skip('invalid_date', `${String(startDate)}–${String(endDate)} aren't an official duty's days: write them as YYYY-MM-DD, at most ${OD_MAX_DAYS} days in a row.`);
        continue;
      }
      const name = nameOf.get(employeeId);
      if (!name) {
        skip('not_found', 'Employee not found.');
        continue;
      }
      const meets = (o: { employeeId: string; startDate: string; endDate: string }) => o.employeeId === employeeId && o.startDate <= endDate && startDate <= o.endDate;
      const same = (o: { startDate: string; endDate: string }) => o.startDate === startDate && o.endDate === endDate;
      const earlier = made.find(meets);
      if (earlier) {
        const words = earlier.row !== null ? (same(earlier) ? odSameRowText(earlier.row) : odOverlapsRowText(earlier.row)) : `${name} has official duty on these days twice in this import: brought over once.`;
        skip(same(earlier) ? 'duplicate' : 'overlap', words);
        continue;
      }
      const wasLinked = entry.zohoLinkId && linkedKeys.has(entry.zohoLinkId) ? linked.find((l) => l.zohoLinkId === entry.zohoLinkId) : undefined;
      if (wasLinked) {
        skip('duplicate', alreadyOdText(fromDateOnly(wasLinked.startDate), fromDateOnly(wasLinked.endDate), how(wasLinked)));
        continue;
      }
      const existing = there.find(meets);
      if (existing) {
        if (same(existing)) skip('duplicate', alreadyOdText(existing.startDate, existing.endDate, how(existing)));
        else skip('overlap', odOverlapsText(existing.startDate, existing.endDate, how(existing)));
        continue;
      }
      const employment = employments.find((e) => e.employeeId === employeeId && fromDateOnly(e.joinDate) <= startDate && (e.endDate === null || fromDateOnly(e.endDate) >= endDate));
      if (!employment) {
        skip('no_employment', `${shownDate(startDate)}${endDate === startDate ? '' : `–${shownDate(endDate)}`} isn't within one of ${name}'s employments.`);
        continue;
      }
      const refusal = this.refusalOf(employment, name);
      if (refusal) {
        skip('no_employment', refusal);
        continue;
      }
      // what its days meet, reported for history, never refusing it
      const days = dayFacts(employment.shift?.workingDays ?? DEFAULT_WORKING_DAYS, odDates(startDate, endDate), {
        holidays: holidayOn,
        leave: [
          ...leave
            .filter((l) => l.employeeId === employeeId)
            .map((l) => ({ startDate: fromDateOnly(l.startDate), endDate: fromDateOnly(l.endDate), halfDay: l.halfDay, status: statusWords(l.status), type: l.type.nameEn })),
          ...(options.leave ?? []).filter((l) => l.employeeId === employeeId).map((l) => ({ startDate: l.from, endDate: l.to, halfDay: false, status: l.status, type: l.type })),
        ],
        wfh: [
          ...wfh.filter((w) => w.employeeId === employeeId).map((w) => ({ date: fromDateOnly(w.date), status: statusWords(w.status) })),
          ...(options.wfh ?? []).filter((w) => w.employeeId === employeeId).map((w) => ({ date: w.date, status: w.status })),
        ],
        compensatory: comp.flatMap((c) => (c.employeeId === employeeId && c.dayOff ? [{ date: fromDateOnly(c.dayOff), status: statusWords(c.status) }] : [])),
        od: [],
      });
      const warnings = odDaysProblems({ startDate, endDate, fullDay: true, fromTime: null, toTime: null }, days, name);
      // pending in Zoho: the approver in charge (19 October 2026), else straight to HR, as a request sent
      let approver: Awaited<ReturnType<typeof approverFor>> = null;
      if (entry.pending) {
        if (!approvers.has(employment.id)) approvers.set(employment.id, await approverFor(db, { employeeId, managerId: employment.managerId, departmentId: employment.departmentId }));
        approver = approvers.get(employment.id) ?? null;
      }
      const status: LeaveStatus = entry.pending ? firstLeaveStatus(approver !== null) : 'approved';
      let id = '';
      if (userId) {
        const saved = await db.odRequest.create({
          data: {
            employeeId,
            employmentId: employment.id,
            startDate: toDateOnly(startDate),
            endDate: toDateOnly(endDate),
            fullDay: true,
            place: OD_IMPORT_PLACE,
            reason: entry.reason.trim().slice(0, 1000) || OD_IMPORT_PLACE,
            late: false,
            status,
            managerId: approver?.employeeId ?? null,
            approverRole: approver?.role ?? null,
            recordedByHr: !entry.pending,
            warnings,
            createdById: userId,
            importId: options.importId ?? null,
            zohoLinkId: entry.zohoLinkId ?? null,
          },
          select: { id: true },
        });
        id = saved.id;
        if (entry.pending) {
          await this.step(db, id, userId, { kind: 'submitted', comment: `${options.comment ?? 'Imported'}: pending in Zoho People.` });
          if (!approver) await this.step(db, id, null, { kind: 'no_manager' });
        } else await this.step(db, id, userId, { kind: 'imported', comment: options.comment ?? null });
      }
      made.push({ employeeId, startDate, endDate, row });
      if (entry.zohoLinkId) linkedKeys.add(entry.zohoLinkId);
      result.recorded.push({ employeeId, startDate, endDate, id, status, warnings, zohoLinkId: entry.zohoLinkId ?? null, row });
    }
    return result;
  }

  // ---------- helpers ----------

  /** The caller, with their own employee profile and the C-level people. */
  async caller(user: SessionUser): Promise<Caller> {
    const [me, confidential] = await Promise.all([
      user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { id: true } }) : null,
      this.confidential.view(user),
    ]);
    // whom they stand in for today, and their own stand-in while away (owner, 25 October 2026: "To a stand-in")
    return { user, employeeId: me?.id ?? null, confidential, standIn: await standInViewOf(this.prisma, me?.id ?? null, user) };
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
   * Why someone can't have an official duty under an employment (null: they may): none, or a freelancer. `name`: theirs
   * when HR records it.
   */
  private refusalOf(employment: EmploymentRow | null, name: string | null = null): string | null {
    if (!employment) return name ? `${name} has no current employment.` : "You have no current employment, so you can't ask for an official duty.";
    if (employment.employmentType === 'freelance') {
      return `${name ? `${name} works` : 'You work'} freelance, outside the labour law and its working hours: no official duty is needed.`;
    }
    return null;
  }

  /**
   * The person HR (or the CEO) records official duty for, if they may: never their own (403); one hidden from them isn't
   * there (404); a C-level person's only the CEO's and HR's who see them, anyone else's HR's (403).
   */
  private async recordable(employeeId: string, caller: Caller): Promise<{ id: string; fullNameEn: string }> {
    if (caller.employeeId === employeeId) throw new ForbiddenException('Someone else in HR has to record your own official duty, or ask for it from My Requests.');
    const person = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullNameEn: true } });
    if (!person || caller.confidential?.hidden.has(employeeId)) throw new NotFoundException('Employee not found.');
    const confidential = caller.confidential?.all.has(employeeId) ?? false;
    if (!recordsOdFor(caller.user, confidential)) {
      throw new ForbiddenException(confidential ? "A C-level person's official duty is recorded by the CEO." : 'Only HR records an official duty for someone.');
    }
    return person;
  }

  /** A request as the shared rules read it: one day unless its last is sent, a full day unless part of one is (HR's check: no place or reason). */
  private inputOf(dto: Pick<CreateOdDto, 'startDate' | 'endDate' | 'fullDay' | 'fromTime' | 'toTime'> & { place?: string; reason?: string }): OdInput {
    return {
      startDate: dto.startDate,
      endDate: dto.endDate ?? dto.startDate,
      fullDay: dto.fullDay !== false,
      fromTime: dto.fullDay === false ? (dto.fromTime ?? null) : null,
      toTime: dto.fullDay === false ? (dto.toTime ?? null) : null,
      place: dto.place ?? '',
      reason: dto.reason ?? '',
    };
  }

  /** Why a request's days aren't within the employment its first day is in (none: they are). */
  private inEmployment(employment: EmploymentRow, input: Pick<OdInput, 'endDate'>): string[] {
    const endDate = fromDateOnly(employment.endDate);
    return endDate && input.endDate > endDate ? [`The official duty must be within the employment, which ended on ${shownDate(endDate)}.`] : [];
  }

  /** The payroll runs of a request's months (with their status), for a month with the CEO, approved or paid. */
  private async payrollMonths(db: Db, input: Pick<OdInput, 'startDate' | 'endDate'>): Promise<OdPayrollMonth[]> {
    if (!isDateOnly(input.startDate) || !isDateOnly(input.endDate) || input.endDate < input.startDate) return [];
    const runs = await db.payrollRun.findMany({
      where: { month: { gte: toDateOnly(`${input.startDate.slice(0, 7)}-01`), lte: toDateOnly(`${input.endDate.slice(0, 7)}-01`) } },
      select: { month: true, status: true },
    });
    return runs.map((r) => ({ month: fromDateOnly(r.month).slice(0, 7), status: r.status }));
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
    // a compensatory day off (26 October 2026), as a compensatory day off is refused on a day of official duty
    const comp = await db.compensatoryRequest.findMany({ where: { employeeId, status: { in: [...TAKING] }, dayOff: range, AND: [TAKES_DAY_OFF] }, select: { dayOff: true, status: true } });
    // a day worked compensated already (27 October 2026): an official duty on it needs no compensation of its own
    const done = await db.compensatoryRequest.findMany({ where: { employeeId, status: { in: [...TAKING] }, dayWorked: range }, select: { dayWorked: true, status: true } });
    const ods = await db.odRequest.findMany({
      where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: range.lte }, endDate: { gte: range.gte }, ...(except && { id: { not: except } }) },
      select: { startDate: true, endDate: true, status: true, fullDay: true, fromTime: true, toTime: true },
    });
    return dayFacts(employment.shift?.workingDays ?? DEFAULT_WORKING_DAYS, dates, {
      holidays: new Map(holidays.map((h) => [fromDateOnly(h.date), h.nameEn])),
      leave: leave.map((l) => ({ startDate: fromDateOnly(l.startDate), endDate: fromDateOnly(l.endDate), halfDay: l.halfDay, status: statusWords(l.status), type: l.type.nameEn })),
      wfh: wfh.map((w) => ({ date: fromDateOnly(w.date), status: statusWords(w.status) })),
      compensatory: comp.flatMap((c) => (c.dayOff ? [{ date: fromDateOnly(c.dayOff), status: statusWords(c.status) }] : [])),
      compensated: done.map((c) => ({ date: fromDateOnly(c.dayWorked)!, status: statusWords(c.status) })),
      od: ods.map((o) => ({ startDate: fromDateOnly(o.startDate), endDate: fromDateOnly(o.endDate), status: statusWords(o.status), fullDay: o.fullDay, fromTime: timeOf(o.fromTime), toTime: timeOf(o.toTime) })),
    });
  }

  /** What a request's compensation is on a rest day or an official holiday (27 October 2026): HR's check and the forms show it. */
  private compensationView(input: OdInput, days: readonly OdDayFacts[], rules: CompensatoryRules, employment: EmploymentRow): OdCompensationView {
    const earned = odEarned(input, days, rules);
    return {
      onDayOff: earned !== null,
      needed: odNeedsCompensation(input, days, rules),
      earned,
      cashDays: earned ? compensatoryCashDays(earned, rules, hoursADayOf(employment)) : 0,
      already: earned ? (days[0]?.compensated?.status ?? null) : null,
    };
  }

  /**
   * A request saved, checked in a transaction holding the employee's row: its shapes, the timing, the hours against the
   * shift, its days, and that they are all within the employment; an employee's sent to the approver in charge (or HR),
   * HR's (`byHr`) approved at once, past the 3-day limit with the warning, in a month whose payroll is still open.
   */
  private async submit(employment: EmploymentRow, dto: CreateOdDto, caller: Caller, byHr = false): Promise<string> {
    const user = caller.user;
    const employeeId = employment.employeeId;
    const input = this.inputOf(dto);
    // on a rest day or an official holiday (27 October 2026): the compensation sent, by the Compensatory Setup's rules
    const asked = compensationOf(dto);
    const rules = await this.compensatory.rules();
    const inEmployment = this.inEmployment(employment, input);
    // the approver in charge (19 October 2026): the direct manager, else the team lead, else the department's head
    const approver = await approverFor(this.prisma, { employeeId, managerId: employment.managerId, departmentId: employment.departmentId });
    const managerId = approver?.employeeId ?? null;
    const approverRole = approver?.role ?? null;
    const status: LeaveStatus = byHr ? 'approved' : firstLeaveStatus(managerId !== null);
    const today = todayInCairo();
    const late = odRequestedAfter(input.startDate, today);

    const made = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const days = await this.daysOf(tx, employment, odDates(input.startDate, input.endDate));
      const name = employment.employee.fullNameEn;
      // its compensatory day, when it earns one and none compensates the day already
      const earned = odEarned(input, days, rules);
      const compensated = !!asked && !!earned && odNeedsCompensation(input, days, rules);
      const comp = compensated ? await this.compensatory.odCheck(tx, employment, input.startDate, asked, today, byHr ? name : null) : { problems: [], warnings: [] };
      let warnings: string[] = [];
      if (byHr) {
        const read = odInputProblems(input);
        if (read.length) throw new BadRequestException(read);
        const checked = odRecordCheck(input, days, shiftOf(employment), today, name, await this.payrollMonths(tx, input), asked, rules);
        if (inEmployment.length || checked.problems.length || comp.problems.length) throw new BadRequestException([...inEmployment, ...checked.problems, ...comp.problems]);
        warnings = checked.warnings;
      } else {
        const problems = [...inEmployment, ...odRequestProblems(input, days, shiftOf(employment), today, asked, rules), ...comp.problems];
        if (problems.length) throw new BadRequestException(problems);
      }
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
          recordedByHr: byHr,
          warnings,
          createdById: user.id,
        },
        select: { id: true },
      });
      if (byHr) await this.step(tx, row.id, user.id, { kind: 'recorded_by_hr' });
      else {
        await this.step(tx, row.id, user.id, { kind: 'submitted' });
        if (!managerId) await this.step(tx, row.id, null, { kind: 'no_manager' });
      }
      const linked: OdCompensatoryMade | null = compensated
        ? await this.compensatory.createForOd(tx, {
            odId: row.id,
            employment,
            dayWorked: input.startDate,
            asked: asked!,
            earned: earned!,
            hoursWorked: input.fullDay ? null : odPartHours(input),
            status,
            managerId,
            approverRole,
            byHr,
            reason: input.reason,
            warnings: comp.warnings,
            userId: user.id,
          })
        : null;
      return { id: row.id, warnings: [...warnings, ...comp.warnings], linked };
    });
    const id = made.id;
    await this.audit.record({
      userId: user.id,
      action: byHr ? 'record' : 'create',
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
        ...(byHr && { recordedByHr: true }),
        ...(made.warnings.length && { warnings: made.warnings }),
        ...(made.linked && { compensatoryId: made.linked.id }),
      },
    });
    if (made.linked) await this.compensatory.createdForOd(made.linked, id, user);
    return id;
  }

  /** The months of a request's days up to today filled again on their draft payroll runs, once its days count differently. */
  private async refill(r: { employeeId: string; startDate: Date; endDate: Date }, user: SessionUser): Promise<void> {
    await this.refillDays(r.employeeId, [{ startDate: fromDateOnly(r.startDate), endDate: fromDateOnly(r.endDate) }], user);
  }

  /** The months of someone's official duties' days up to today filled again on their draft payroll runs, each month once. */
  private async refillDays(employeeId: string, ranges: readonly { startDate: string; endDate: string }[], user: SessionUser): Promise<void> {
    const today = todayInCairo();
    const months = new Set(ranges.flatMap((r) => odDates(r.startDate, r.endDate)).filter((d) => d <= today).map((d) => d.slice(0, 7)));
    for (const month of [...months].sort()) await this.fill.fillMonth(employeeId, month, user);
  }

  /** Logs a step on a request, in the transaction the step is taken in. */
  private async step(db: Db, requestId: string, actorId: string | null, step: { kind: string; decision?: string; comment?: string | null; onBehalfOf?: string | null }) {
    await db.odRequestStep.create({ data: { requestId, actorId, kind: step.kind, decision: step.decision ?? null, comment: step.comment ?? null, onBehalfOfId: step.onBehalfOf ?? null } });
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
    const [names, locked] = await Promise.all([
      userNames(
        this.prisma,
        rows.flatMap((r) => r.steps.map((s) => s.actor)),
      ),
      // the months whose payroll had moved on when it was approved or cancelled, still to handle (27 October 2026)
      this.lockedChanges.openMonthsOf('od', rows.map((r) => r.id)),
    ]);
    return rows.map((r) => ({ ...odView(r, caller, names), payrollLocked: locked.get(r.id) ?? [] }));
  }
}
