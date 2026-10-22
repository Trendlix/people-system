import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  annualAvailable,
  DEFAULT_WORKING_DAYS,
  employeeMayCancelLeave,
  firstLeaveStatus,
  LEAVE_OPEN_STATUSES,
  LEAVE_STATUS_LABELS,
  leaveDaysBetween,
  leaveDecisionNeedsComment,
  leaveDecisionStepKind,
  leaveRequestProblems,
  leaveStage,
  leaveStatusAfterApproval,
  permissionHoursText,
  serviceMonths,
  takesFromAnnual,
  underLabourLaw,
  type LeaveGender,
  type LeaveStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { fromDateOnly, shownDate, todayInCairo, toDateOnly } from '../common/date-only.js';
import type { LeaveType } from '../generated/prisma/client.js';
import { NoticesService } from '../notifications/notices.service.js';
import { approverFor } from '../organisation/departments/leads.js';
import { userNames } from '../payroll/adjustments/people.js';
import { lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  decidesStage,
  hiddenRequest,
  hrMayCancel,
  isConfidentialRequest,
  isHr,
  isRequestManager,
  isRequester,
  noLeaveMessage,
  othersWhere,
  scopeWhere,
  seesRequest,
  waitingWhere,
  type Caller,
} from './access.js';
import { checkedDocuments } from './documents.js';
import { LeaveBalancesService, TAKING, type LeaveBalancesView, type LeaveEmployment } from './leave-balances.service.js';
import type { CreateLeaveRequestDto, DecideLeaveDto, HrCancelLeaveDto, LeaveCalendarQueryDto, ListLeaveRequestsDto, RecordLeaveRequestDto } from './leave.dto.js';
import { LeavePayrollService } from './leave-payroll.service.js';
import { PermissionRequestsService, type PermissionCalendarItem } from './permissions.service.js';
import { recordLeaveStep } from './steps.js';
import { DOCUMENT_ENTITY, partiesOf, placeOf, REQUEST_ENTITY, REQUEST_INCLUDE, requestView, rulesOf, type LeaveRequestView, type RequestRow } from './views.js';

const NOT_FOUND = 'Leave request not found.';

/** A status as a message says it: "with HR", "approved". */
const statusWords = (status: string) => {
  const label = LEAVE_STATUS_LABELS[status as LeaveStatus] ?? status;
  return label[0].toLowerCase() + label.slice(1);
};

/** A day off on the calendar, as GET /leave/calendar sends it: leave (kind 'leave'), beside the permissions (PermissionCalendarItem). */
export interface LeaveCalendarItem {
  id: string;
  kind: 'leave';
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  type: { id: string; nameEn: string; nameAr: string };
  startDate: string;
  endDate: string;
  halfDay: boolean;
  status: LeaveStatus;
}

// Leave requests (owner, 18 October 2026: "can you apply the leaves according to the law?"; the approval he chose: the
// direct manager, then HR, straight to HR without a manager). An employee asks for leave of a type on under their current
// employment, from My Requests, with the documents the type needs; a request that breaks one of the type's rules (the
// law's: packages/shared leaveRequestProblems) is refused with every reason, and one on days another request already
// takes is refused too. It goes to the direct manager they have when they send it (a manager who is the employee
// themself counts as none), then HR; each approves, or rejects with a comment; nobody decides their own. Without a
// direct manager it goes to the person in charge of where they work (owner, 19 October 2026: "i want to add department
// lead person, the person in charge"): their team lead, else their department's head, never themself, as the manager
// stage (approverRole says which); with nobody in charge, straight to HR. HR records leave
// on an employee's behalf (e.g. sick leave reported after): approved at once, without the notice an employee's request
// needs. The employee cancels theirs while it is being decided, or approved and not started; HR cancels an approved one
// with a comment, its days back in the balance. Approved or cancelled leave works the month's draft payroll lines out
// again (leave-payroll.service.ts). Each step is logged on the request (steps.ts) and in the audit log, every view of a
// document too. Those who may not see a request (its employee, the manager it was sent to, their manager now, HR, the
// CEO) are told it isn't there. A C-level person's (owner, 19 October 2026: "make C level Employees details not visible
// to HR"): its HR stage is the CEO's, HR and their manager now don't see it, nor their balances (access.ts).
@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly balances: LeaveBalancesService,
    private readonly payroll: LeavePayrollService,
    private readonly confidential: ConfidentialService,
    private readonly permissions: PermissionRequestsService,
    private readonly notices: NoticesService,
  ) {}

  // ---------- the employee's own ----------

  /** The caller's own balances for a year. */
  async myBalances(year: number | undefined, user: SessionUser): Promise<LeaveBalancesView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Your sign-in has no employee profile, so there is no leave balance.');
    return this.balances.balances(caller.employeeId, year ?? Number(todayInCairo().slice(0, 4)));
  }

  /** The caller's own requests, the latest first; none without an employee profile. */
  async mine(user: SessionUser): Promise<LeaveRequestView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.leaveRequest.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], include: REQUEST_INCLUDE });
    return this.views(rows, caller);
  }

  /** An employee's request, with its documents, under their current employment. */
  async create(dto: CreateLeaveRequestDto, files: Express.Multer.File[] | undefined, user: SessionUser): Promise<LeaveRequestView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Only an employee can ask for leave: your sign-in has no employee profile.');
    const employment = await this.balances.employmentOf(caller.employeeId);
    if (!employment || employment.endDate !== null) throw new ConflictException("You have no current employment, so you can't ask for leave.");
    const id = await this.submit(employment, dto, files, caller, false);
    // to the one in charge of its first step (Phase 4: notifications), once it is saved
    await this.notices.leave(id, 'sent');
    return this.one(id, user);
  }

  /** The employee cancels their own request: while it is being decided, or approved and not started. */
  async cancelMine(id: string, user: SessionUser): Promise<LeaveRequestView> {
    const caller = await this.caller(user);
    const before = await this.prisma.leaveRequest.findUnique({ where: { id }, include: { type: true } });
    if (!before || !isRequester(before, caller)) throw new NotFoundException(NOT_FOUND);
    const today = todayInCairo();
    const startDate = fromDateOnly(before.startDate);
    if (!employeeMayCancelLeave({ status: before.status, startDate }, today)) {
      throw new ConflictException(
        before.status === 'approved'
          ? 'This leave has started, so it can no longer be cancelled here. Ask HR to cancel it.'
          : `This request is ${statusWords(before.status)}, so it can't be cancelled.`,
      );
    }
    if (before.status === 'approved') await this.assertYearOpen(before.type, startDate);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.leaveRequest.updateMany({ where: { id, status: before.status }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException("This request was decided meanwhile, so it can't be cancelled. Reload the page to see where it is.");
      await recordLeaveStep(tx, id, user.id, { kind: 'cancelled' });
    });
    await this.audit.record({ userId: user.id, action: 'cancel', entityType: REQUEST_ENTITY, entityId: id, diff: { employeeId: before.employeeId, status: { from: before.status, to: 'cancelled' } } });
    if (before.status === 'approved') await this.payroll.syncDrafts(before.employeeId, startDate, fromDateOnly(before.endDate), user);
    return this.one(id, user);
  }

  // ---------- HR on an employee's behalf ----------

  /**
   * HR records leave for an employee (e.g. sick leave reported after): approved at once, under the employment the days
   * are in, without the notice an employee's request needs; the type's other rules hold. Never HR's own.
   */
  async record(dto: RecordLeaveRequestDto, files: Express.Multer.File[] | undefined, user: SessionUser): Promise<LeaveRequestView> {
    const caller = await this.caller(user);
    if (!isHr(user)) throw new ForbiddenException('Only HR records leave on an employee’s behalf.');
    if (caller.employeeId === dto.employeeId) throw new ForbiddenException('Someone else in HR has to record your own leave, or send it from My Requests.');
    const person = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { fullNameEn: true } });
    // a form with files is read after the guards: a C-level person hidden from HR is checked here (owner, 19 October 2026)
    if (!person || caller.confidential?.hidden.has(dto.employeeId)) throw new NotFoundException('Employee not found.');
    const covering = await this.prisma.employment.findFirst({
      where: { employeeId: dto.employeeId, joinDate: { lte: toDateOnly(dto.startDate) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(dto.endDate) } }] },
      orderBy: { joinDate: 'desc' },
      select: { id: true },
    });
    const employment = covering ? (await this.balances.employments([covering.id]))[0] : null;
    if (!employment) throw new BadRequestException([`Choose days within one of ${person.fullNameEn}'s employments.`]);
    const id = await this.submit(employment, dto, files, caller, true);
    await this.payroll.syncDrafts(dto.employeeId, dto.startDate, dto.endDate, user);
    return this.one(id, user);
  }

  // ---------- deciding and seeing them ----------

  /**
   * The requests the caller sees, the latest first: HR and the CEO everyone's; a manager those sent to them and their
   * team's (not their own: those are in My Requests). `waiting`: those waiting for the caller's decision.
   */
  async list(query: ListLeaveRequestsDto, user: SessionUser): Promise<LeaveRequestView[]> {
    const caller = await this.caller(user);
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        AND: [
          othersWhere(caller),
          query.status === 'waiting' ? waitingWhere(caller) : query.status ? { status: query.status } : {},
          query.employeeId ? { employeeId: query.employeeId } : {},
          query.from ? { endDate: { gte: toDateOnly(query.from) } } : {},
          query.to ? { startDate: { lte: toDateOnly(query.to) } } : {},
        ],
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      include: REQUEST_INCLUDE,
    });
    return this.views(rows, caller);
  }

  /**
   * How many requests wait for the caller's decision, for the menu's badges: the leave and the permission requests (owner,
   * 19 October 2026: permission "In the system, like leave") together, and each.
   */
  async counts(user: SessionUser): Promise<{ waiting: number; leave: number; permissions: number }> {
    const caller = await this.caller(user);
    const [leave, permissions] = await Promise.all([this.prisma.leaveRequest.count({ where: waitingWhere(caller) }), this.permissions.waitingCount(caller)]);
    return { waiting: leave + permissions, leave, permissions };
  }

  async one(id: string, user: SessionUser): Promise<LeaveRequestView> {
    const caller = await this.caller(user);
    return (await this.views([await this.visible(id, caller)], caller))[0];
  }

  /** A document's file, for those who may see the request; every view is in the audit log. */
  async document(id: string, documentId: string, user: SessionUser) {
    const caller = await this.caller(user);
    const request = await this.visible(id, caller);
    const file = await this.prisma.leaveDocument.findFirst({ where: { id: documentId, requestId: id }, select: { id: true, fileName: true, mimeType: true, data: true } });
    if (!file) throw new NotFoundException('Document not found.');
    await this.audit.record({
      userId: user.id,
      action: 'view_restricted',
      entityType: DOCUMENT_ENTITY,
      entityId: file.id,
      diff: { requestId: id, employeeId: request.employeeId, fields: ['file'] },
    });
    return { data: Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength), type: file.mimeType, fileName: file.fileName };
  }

  /**
   * The decision of the stage the request is at, by its decider: the direct manager it was sent to, then HR; never the
   * employee's own. Approve moves it on (HR's approves it); reject, with a comment, ends it. 409 once it moved on.
   */
  async decide(id: string, dto: DecideLeaveDto, user: SessionUser): Promise<LeaveRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = partiesOf(before);
    const stage = leaveStage(before.status);
    if (!stage) throw new ConflictException(`This request is ${statusWords(before.status)}, so there is nothing left to decide. Reload the page to see it.`);
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else has to decide your own leave request.');
    if (!decidesStage(stage, parties, caller)) {
      // one of its deciders, on a page left open while it moved on (or not with them yet)
      if (isRequestManager(parties, caller) || decidesStage('hr', parties, caller)) {
        throw new ConflictException(`This request is ${statusWords(before.status)} now, so it isn't waiting for your decision. Reload the page to see where it is.`);
      }
      throw new ForbiddenException(
        isConfidentialRequest(parties, caller)
          ? "A C-level person's leave request is decided by its direct manager, then the CEO."
          : "Only the request's direct manager and HR decide a leave request.",
      );
    }
    const comment = dto.comment ?? null;
    if (leaveDecisionNeedsComment(dto.decision) && !comment) throw new BadRequestException('Write a comment: why the leave is rejected.');
    const to: LeaveStatus = dto.decision === 'reject' ? 'rejected' : leaveStatusAfterApproval(stage);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.leaveRequest.updateMany({
        where: { id, status: before.status },
        data: to === 'rejected' ? { status: to, rejectedStage: stage, rejectReason: comment } : { status: to },
      });
      if (!count) throw new ConflictException('This request was decided or cancelled meanwhile. Reload the page to see where it is.');
      await recordLeaveStep(tx, id, user.id, { kind: leaveDecisionStepKind(stage), decision: dto.decision, comment });
    });
    await this.audit.record({
      userId: user.id,
      action: dto.decision === 'reject' ? 'reject' : 'approve',
      entityType: REQUEST_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, stage, decision: dto.decision, status: { from: before.status, to }, ...(comment && { comment }) },
    });
    if (to === 'approved') await this.payroll.syncDrafts(before.employeeId, fromDateOnly(before.startDate), fromDateOnly(before.endDate), user);
    // to the next step's decider, or the employee once it is approved or rejected (Phase 4: notifications)
    await this.notices.leave(id, 'decided');
    return this.one(id, user);
  }

  /** HR cancels an approved request, saying why: its days are back in the balance. Never HR's own; not in a closed year. */
  async hrCancel(id: string, dto: HrCancelLeaveDto, user: SessionUser): Promise<LeaveRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = partiesOf(before);
    if (!isHr(user)) throw new ForbiddenException('Only HR cancels an approved leave.');
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else in HR has to cancel your own leave.');
    if (!hrMayCancel({ ...parties, status: before.status }, caller)) {
      throw new ConflictException(`This request is ${statusWords(before.status)}: HR cancels approved leave only. ${before.status === 'with_hr' ? 'Reject it instead.' : ''}`.trim());
    }
    const startDate = fromDateOnly(before.startDate);
    await this.assertYearOpen(before.type, startDate);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.leaveRequest.updateMany({ where: { id, status: 'approved' }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException('This request was cancelled meanwhile. Reload the page to see where it is.');
      await recordLeaveStep(tx, id, user.id, { kind: 'cancelled', comment: dto.comment });
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: REQUEST_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, status: { from: 'approved', to: 'cancelled' }, comment: dto.comment },
    });
    await this.payroll.syncDrafts(before.employeeId, startDate, fromDateOnly(before.endDate), user);
    await this.notices.leave(id, 'cancelled_by_hr');
    return this.one(id, user);
  }

  // ---------- an employee's leave and the calendar ----------

  /**
   * A person's leave for a year (HR, the CEO, Finance, the person and their manager now): the balances as their own, and
   * their requests that touch the year, the latest first.
   */
  async employeeLeave(employeeId: string, year: number | undefined, user: SessionUser): Promise<LeaveBalancesView & { requests: LeaveRequestView[] }> {
    const caller = await this.caller(user);
    if (!(await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new NotFoundException('Employee not found.');
    await this.balances.assertSees(employeeId, caller);
    const y = year ?? Number(todayInCairo().slice(0, 4));
    const balances = await this.balances.balances(employeeId, y);
    const rows = await this.prisma.leaveRequest.findMany({
      where: { employeeId, startDate: { lte: toDateOnly(`${y}-12-31`) }, endDate: { gte: toDateOnly(`${y}-01-01`) } },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      include: REQUEST_INCLUDE,
    });
    return { ...balances, requests: await this.views(rows, caller) };
  }

  /**
   * Who is off from `from` to `to` (this month unless sent; at most a year): approved leave, and for HR the requests
   * being decided too; HR and the CEO everyone's, a manager their team's and their own, anyone else their own. By a
   * department (its teams with it) or a team when one is chosen. With the permissions the same way (owner's brief, 19
   * October 2026: "the calendar (as hours)"), each with its hours, after the leave.
   */
  async calendar(query: LeaveCalendarQueryDto, user: SessionUser): Promise<(LeaveCalendarItem | PermissionCalendarItem)[]> {
    const caller = await this.caller(user);
    const today = todayInCairo();
    const from = query.from ?? `${today.slice(0, 7)}-01`;
    const to = query.to ?? lastDay(today.slice(0, 7));
    if (to < from) throw new BadRequestException(["The last day can't be before the first."]);
    if (Number(toDateOnly(to)) - Number(toDateOnly(from)) > 366 * 86_400_000) throw new BadRequestException(['Choose at most a year of days.']);
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        AND: [
          scopeWhere(caller),
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
        halfDay: true,
        status: true,
        employee: { select: { id: true, fullNameEn: true } },
        employment: { select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
        type: { select: { id: true, nameEn: true, nameAr: true } },
      },
    });
    const leave = rows.map((r) => ({
      id: r.id,
      kind: 'leave' as const,
      employee: { id: r.employee.id, fullNameEn: r.employee.fullNameEn, ...placeOf(r.employment.department) },
      type: r.type,
      startDate: fromDateOnly(r.startDate),
      endDate: fromDateOnly(r.endDate),
      halfDay: r.halfDay,
      status: r.status as LeaveStatus,
    }));
    const permissions = await this.permissions.calendarItems(scopeWhere(caller), isHr(user) ? TAKING : ['approved'], from, to, query.departmentId);
    return [...leave, ...permissions];
  }

  // ---------- helpers ----------

  /** The caller, with their own employee profile: the one their account is linked to. */
  async caller(user: SessionUser): Promise<Caller> {
    const [me, confidential] = await Promise.all([
      (user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { id: true } }) : null),
      // the C-level people, and those hidden from the caller (owner, 19 October 2026)
      this.confidential.view(user),
    ]);
    return { user, employeeId: me?.id ?? null, confidential };
  }

  /**
   * A request saved, checked against its type's rules in a transaction holding the employee's row (two sent together
   * can't both take the last days): an employee's to the direct manager (or HR), HR's approved at once.
   */
  private async submit(employment: LeaveEmployment, dto: CreateLeaveRequestDto, files: Express.Multer.File[] | undefined, caller: Caller, byHr: boolean): Promise<string> {
    const user = caller.user;
    const employeeId = employment.employeeId;
    const name = byHr ? employment.employee.fullNameEn : null;
    // leave is the labour law's (Arts. 124–133); a freelancer works outside it (owner, 18 October 2026; Art. 1(1)), and so
    // does an unpaid intern (owner, 19 October 2026), with no leave to ask for or record
    if (!underLabourLaw(employment.employmentType)) throw new BadRequestException([noLeaveMessage(employment.employmentType, name)]);
    const type = await this.prisma.leaveType.findUnique({ where: { id: dto.typeId } });
    if (!type) throw new BadRequestException(['Choose a leave type from the list.']);
    if (!type.active) throw new BadRequestException([`${type.nameEn} is turned off, so it can't be asked for. Choose another type.`]);
    const { documents, problems: documentProblems } = checkedDocuments(files);
    const halfDay = dto.halfDay ?? false;
    const today = todayInCairo();
    const inEmployment: string[] = [];
    if (dto.startDate < employment.joinDate) inEmployment.push(`The leave must be within the employment, which started on ${shownDate(employment.joinDate)}.`);
    if (employment.endDate && dto.endDate > employment.endDate) inEmployment.push(`The leave must be within the employment, which ended on ${shownDate(employment.endDate)}.`);
    if (takesFromAnnual(type.balance) && dto.startDate <= dto.endDate) await this.assertYearOpen(type, dto.startDate);
    const holidays =
      dto.startDate <= dto.endDate
        ? (await this.prisma.holiday.findMany({ where: { date: { gte: toDateOnly(dto.startDate), lte: toDateOnly(dto.endDate) } }, select: { date: true } })).map((h) => fromDateOnly(h.date))
        : [];
    const days = leaveDaysBetween(dto.startDate, dto.endDate, { workingDays: employment.workingDays ?? DEFAULT_WORKING_DAYS, holidays, calendarDays: type.calendarDays, halfDay });
    // the direct manager, else the team lead, else the department's head (owner, 19 October 2026), never the employee
    // themself: the manager stage's decider, kept in managerId; nobody in charge: straight to HR
    const approver = await approverFor(this.prisma, { employeeId, managerId: employment.managerId, departmentId: employment.departmentId });
    const managerId = approver?.employeeId ?? null;
    const approverRole = approver?.role ?? null;
    const status: LeaveStatus = byHr ? 'approved' : firstLeaveStatus(managerId !== null);
    const uploadedAt = Date.now();

    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const year = Number(dto.startDate.slice(0, 4));
      const [annual, ofType] = await Promise.all([
        this.balances.annual(employment, year, today, tx),
        tx.leaveRequest.findMany({ where: { employeeId, typeId: type.id, status: { in: [...TAKING] } }, select: { startDate: true, days: true } }),
      ]);
      const problems = [
        ...inEmployment,
        ...documentProblems,
        ...leaveRequestProblems(
          { startDate: dto.startDate, endDate: dto.endDate, halfDay, days, documents: files?.length ?? 0, today, byHr },
          rulesOf(type),
          { available: annual.available, usableFrom: annual.usableFrom },
          {
            usedInYear: ofType.filter((r) => r.startDate.getUTCFullYear() === year).reduce((n, r) => n + r.days.toNumber(), 0),
            timesInService: ofType.length,
            serviceMonths: serviceMonths(employment.joinDate, dto.startDate),
            gender: (employment.employee.gender as LeaveGender | null) ?? null,
          },
        ),
      ];
      if (problems.length) throw new BadRequestException(problems);
      // never on days another request already takes
      const overlap = await tx.leaveRequest.findFirst({
        where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: toDateOnly(dto.endDate) }, endDate: { gte: toDateOnly(dto.startDate) } },
        orderBy: { startDate: 'asc' },
        select: { startDate: true, endDate: true, status: true, type: { select: { nameEn: true } } },
      });
      if (overlap) {
        const when = `from ${shownDate(fromDateOnly(overlap.startDate))} to ${shownDate(fromDateOnly(overlap.endDate))}`;
        throw new ConflictException(`${name ? `${name} already has` : 'You already have'} ${overlap.type.nameEn} ${when} (${statusWords(overlap.status)}) on some of these days. Choose other days.`);
      }
      // nor on a day with permission asked for (19 October 2026): a day of leave needs none, so it is cancelled first
      const permission = await tx.permissionRequest.findFirst({
        where: { employeeId, status: { in: [...TAKING] }, date: { gte: toDateOnly(dto.startDate), lte: toDateOnly(dto.endDate) } },
        orderBy: { date: 'asc' },
        select: { date: true, hours: true, status: true },
      });
      if (permission) {
        throw new ConflictException(
          `${name ? `${name} has` : 'You have'} permission for ${permissionHoursText(permission.hours.toNumber())} on ${shownDate(fromDateOnly(permission.date))} (${statusWords(permission.status)}): cancel it first, or choose other days.`,
        );
      }
      const made = await tx.leaveRequest.create({
        data: {
          employeeId,
          employmentId: employment.id,
          typeId: type.id,
          startDate: toDateOnly(dto.startDate),
          endDate: toDateOnly(dto.endDate),
          halfDay,
          days,
          reason: dto.reason ?? null,
          status,
          managerId,
          approverRole,
          recordedByHr: byHr,
          createdById: user.id,
          documents: {
            create: documents.map((d, i) => ({ fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, data: new Uint8Array(d.data), uploadedAt: new Date(uploadedAt + i) })),
          },
        },
        select: { id: true },
      });
      if (byHr) await recordLeaveStep(tx, made.id, user.id, { kind: 'recorded_by_hr' });
      else {
        await recordLeaveStep(tx, made.id, user.id, { kind: 'submitted' });
        if (!managerId) await recordLeaveStep(tx, made.id, null, { kind: 'no_manager' });
      }
      return made.id;
    });
    await this.audit.record({
      userId: user.id,
      action: byHr ? 'record' : 'create',
      entityType: REQUEST_ENTITY,
      entityId: id,
      diff: {
        employeeId,
        typeId: type.id,
        type: type.nameEn,
        startDate: dto.startDate,
        endDate: dto.endDate,
        halfDay,
        days,
        reason: dto.reason ?? null,
        documents: documents.map((d) => d.fileName),
        managerId,
        approverRole,
        status,
      },
    });
    return id;
  }

  /** A year whose annual balance is closed takes no more leave from it, nor gives any back. */
  private async assertYearOpen(type: Pick<LeaveType, 'balance'>, day: string): Promise<void> {
    if (!takesFromAnnual(type.balance)) return;
    const year = Number(day.slice(0, 4));
    if (await this.prisma.leaveYearClosing.findUnique({ where: { year } })) {
      throw new ConflictException(`${year}'s annual leave is closed, so leave from it can't change. Ask HR to reopen its Year Closing first.`);
    }
  }

  /** A request the caller may see; otherwise it isn't there. */
  private async visible(id: string, caller: Caller): Promise<RequestRow> {
    const row = await this.prisma.leaveRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!row || !seesRequest(partiesOf(row), caller)) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /**
   * The requests as the caller sees them, with who took each step and, for those from the annual balance being decided
   * or approved, the annual balance left once they are taken (their year's available, which already counts them).
   */
  private async views(rows: readonly RequestRow[], caller: Caller): Promise<LeaveRequestView[]> {
    if (!rows.length) return [];
    const today = todayInCairo();
    const counted = rows.filter((r) => takesFromAnnual(r.type.balance) && (r.status === 'approved' || (LEAVE_OPEN_STATUSES as readonly string[]).includes(r.status)));
    const [names, employments] = await Promise.all([
      userNames(this.prisma, rows.flatMap((r) => r.steps.map((s) => s.actor))),
      this.balances.employments([...new Set(counted.map((r) => r.employmentId))]),
    ]);
    const byId = new Map(employments.map((e) => [e.id, e]));
    const pairs = [...new Map(counted.map((r) => [`${r.employmentId}:${r.startDate.getUTCFullYear()}`, { employment: byId.get(r.employmentId)!, year: r.startDate.getUTCFullYear() }])).values()].filter(
      (p) => p.employment,
    );
    const figures = await this.balances.yearFigures(pairs, today);
    const available = (r: RequestRow) => {
      const f = figures.get(`${r.employmentId}:${r.startDate.getUTCFullYear()}`);
      return f ? annualAvailable(f) : null;
    };
    // never a C-level person's balance to the manager a request was sent to, who sees their card only (19 October 2026)
    return rows.map((r) => requestView(r, caller, names, counted.includes(r) && !hiddenRequest(r, caller) ? available(r) : null, today));
  }
}
