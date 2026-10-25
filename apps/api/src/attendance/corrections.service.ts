import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  correctionApplyRefusal,
  correctionMoments,
  correctionProblems,
  firstLeaveStatus,
  isOpenLeave,
  LEAVE_STATUS_LABELS,
  leaveDecisionNeedsComment,
  leaveDecisionStepKind,
  leaveStage,
  leaveStatusAfterApproval,
  type CorrectableDay,
  type LeaveStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  decidesStage,
  hiddenRequest,
  isConfidentialRequest,
  isHr,
  isRequestManager,
  isRequester,
  othersWhere,
  seesRequest,
  waitingWhere,
  type Caller,
} from '../leave/access.js';
import type { DecideLeaveDto } from '../leave/leave.dto.js';
import { NoticesService } from '../notifications/notices.service.js';
import { approverFor } from '../organisation/departments/leads.js';
import { userNames } from '../payroll/adjustments/people.js';
import { json } from '../payroll/line-work.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceDaysService, shiftTimesOf } from './attendance-days.service.js';
import { AttendanceFillService } from './attendance-fill.service.js';
import { CorrectionDaysService } from './correction-days.service.js';
import { CORRECTION_ENTITY, CORRECTION_INCLUDE, correctionParties, correctionView, type AttendanceCorrectionView, type CorrectionRow, type DayBefore } from './correction-views.js';
import type { CreateCorrectionDto, ListCorrectionsDto, RecordCorrectionDto } from './corrections.dto.js';

type Db = PrismaService | Prisma.TransactionClient;
type Where = Prisma.AttendanceCorrectionWhereInput;

const NOT_FOUND = 'Attendance correction not found.';
const DAY_ENTITY = 'attendance_day';

/** A status as a message says it: "with HR", "approved". */
const statusWords = (status: string) => {
  const label = LEAVE_STATUS_LABELS[status as LeaveStatus] ?? status;
  return label[0].toLowerCase() + label.slice(1);
};

/** The corrections of a person's month, as their attendance page shows them by day. */
export interface MonthCorrection {
  id: string;
  date: string;
  correctionKind: string;
  status: LeaveStatus;
  checkIn: string | null;
  checkOut: string | null;
}

/** Whether the days of a month can be corrected now, and why not (owner's brief: "only … months whose payroll run isn't approved yet"). */
export interface MonthCorrectable {
  allowed: boolean;
  reason: string | null;
}

// Attendance corrections (owner, 19 October 2026, "Proceed with those": "Attendance corrections with approval ("I forgot
// to check out")"). An employee asks to correct a day of theirs from My Attendance → the day → Ask for a correction: what
// was wrong, the right times and why (packages/shared correctionProblems: a day gone by or today, a month whose payroll
// isn't approved, no correction of the day already being decided, not a day of leave, what each kind needs), under the
// employment the day is in (not a freelancer's). Decided exactly as leave is (leave/access.ts): their direct manager, else
// their team lead, else their department's head, never themself, then HR; nobody in charge: straight to HR; a C-level
// person's HR stage by the CEO (owner, 19 October 2026: "make C level Employees details not visible to HR"). The employee
// cancels theirs while it is being decided. Approved at its last stage, the day is changed (CorrectionDaysService: kept as
// source 'correction' over the day it corrects, which stays as it was, its hours counted again), the month's draft payroll
// line refilled (AttendanceFillService); never while the month's payroll is with the CEO (it would miss it), approved or
// paid. HR corrects a day directly, with a reason, approved at once (never their own; a C-level person's only HR with
// Super Admin). Each step is logged on the correction and in the audit log, the day's change too.
@Injectable()
export class AttendanceCorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly days: AttendanceDaysService,
    private readonly correctionDays: CorrectionDaysService,
    private readonly fill: AttendanceFillService,
    private readonly notices: NoticesService,
  ) {}

  // ---------- the employee's own ----------

  /** The caller's own corrections, the latest day first; none without an employee profile. */
  async mine(user: SessionUser): Promise<AttendanceCorrectionView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.attendanceCorrection.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: CORRECTION_INCLUDE });
    return this.views(rows, caller);
  }

  /** An employee's request to correct a day of theirs. */
  async create(dto: CreateCorrectionDto, user: SessionUser): Promise<AttendanceCorrectionView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Only an employee can ask for a correction: your sign-in has no employee profile.');
    const id = await this.submit(caller.employeeId, dto, caller, false);
    // to the one in charge of its first step (Phase 4: notifications), once it is saved
    await this.notices.correction(id, 'sent');
    return this.one(id, user);
  }

  /** The employee cancels their own correction while it is being decided. */
  async cancelMine(id: string, user: SessionUser): Promise<AttendanceCorrectionView> {
    const caller = await this.caller(user);
    const before = await this.prisma.attendanceCorrection.findUnique({ where: { id } });
    if (!before || !isRequester(before, caller)) throw new NotFoundException(NOT_FOUND);
    if (!isOpenLeave(before.status)) throw new ConflictException(`This correction is ${statusWords(before.status)}, so it can't be cancelled.`);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.attendanceCorrection.updateMany({ where: { id, status: before.status }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException("This correction was decided meanwhile, so it can't be cancelled. Reload the page to see where it is.");
      await this.step(tx, id, user.id, { kind: 'cancelled' });
    });
    await this.audit.record({ userId: user.id, action: 'cancel', entityType: CORRECTION_ENTITY, entityId: id, diff: { employeeId: before.employeeId, date: fromDateOnly(before.date), status: { from: before.status, to: 'cancelled' } } });
    return this.one(id, user);
  }

  // ---------- HR directly ----------

  /** HR corrects a day directly, with a reason: approved at once, the day changed. Never HR's own. */
  async record(dto: RecordCorrectionDto, user: SessionUser): Promise<AttendanceCorrectionView> {
    const caller = await this.caller(user);
    if (!isHr(user)) throw new ForbiddenException('Only HR corrects a day directly.');
    if (caller.employeeId === dto.employeeId) throw new ForbiddenException('Someone else in HR has to correct your own day, or ask for a correction from My Attendance.');
    const person = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true } });
    if (!person || caller.confidential?.hidden.has(dto.employeeId)) throw new NotFoundException('Employee not found.');
    const id = await this.submit(dto.employeeId, dto, caller, true);
    return this.one(id, user);
  }

  // ---------- deciding and seeing them ----------

  /** The corrections of others the caller sees, the latest day first. `waiting`: theirs to decide. */
  async list(query: ListCorrectionsDto, user: SessionUser): Promise<AttendanceCorrectionView[]> {
    const caller = await this.caller(user);
    const rows = await this.prisma.attendanceCorrection.findMany({
      where: {
        AND: [
          othersWhere(caller) as Where,
          query.status === 'waiting' ? (waitingWhere(caller) as Where) : query.status ? { status: query.status } : {},
          query.employeeId ? { employeeId: query.employeeId } : {},
          query.month ? { date: { gte: toDateOnly(firstDay(query.month)), lte: toDateOnly(lastDay(query.month)) } } : {},
        ],
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: CORRECTION_INCLUDE,
    });
    return this.views(rows, caller);
  }

  /** How many corrections wait for the caller's decision (the sidebar's and My Team's counts). */
  async counts(user: SessionUser): Promise<{ waiting: number }> {
    const caller = await this.caller(user);
    return { waiting: await this.prisma.attendanceCorrection.count({ where: waitingWhere(caller) as Where }) };
  }

  async one(id: string, user: SessionUser): Promise<AttendanceCorrectionView> {
    const caller = await this.caller(user);
    return (await this.views([await this.visible(id, caller)], caller))[0];
  }

  /**
   * The decision of the stage the correction is at, by its decider: the manager it was sent to, then HR (a C-level
   * person's: the CEO); never the employee's own. Approve moves it on (HR's applies it); reject, with a comment, ends it.
   */
  async decide(id: string, dto: DecideLeaveDto, user: SessionUser): Promise<AttendanceCorrectionView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = correctionParties(before);
    const stage = leaveStage(before.status);
    if (!stage) throw new ConflictException(`This correction is ${statusWords(before.status)}, so there is nothing left to decide. Reload the page to see it.`);
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else has to decide your own correction.');
    if (!decidesStage(stage, parties, caller)) {
      if (isRequestManager(parties, caller) || decidesStage('hr', parties, caller)) {
        throw new ConflictException(`This correction is ${statusWords(before.status)} now, so it isn't waiting for your decision. Reload the page to see where it is.`);
      }
      throw new ForbiddenException(
        isConfidentialRequest(parties, caller)
          ? "A C-level person's correction is decided by its direct manager, then the CEO."
          : "Only the correction's direct manager and HR decide an attendance correction.",
      );
    }
    const comment = dto.comment ?? null;
    if (leaveDecisionNeedsComment(dto.decision) && !comment) throw new BadRequestException('Write a comment: why the correction is rejected.');
    const to: LeaveStatus = dto.decision === 'reject' ? 'rejected' : leaveStatusAfterApproval(stage);
    const date = fromDateOnly(before.date);
    if (to === 'approved') {
      const refusal = correctionApplyRefusal(date, await this.runStatus(date));
      if (refusal) throw new ConflictException(refusal);
    }
    const change = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.attendanceCorrection.updateMany({
        where: { id, status: before.status },
        data: to === 'rejected' ? { status: to, rejectedStage: stage, rejectReason: comment } : { status: to, ...(to === 'approved' && { appliedAt: new Date() }) },
      });
      if (!count) throw new ConflictException('This correction was decided or cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: leaveDecisionStepKind(stage), decision: dto.decision, comment });
      return to === 'approved' ? this.correctionDays.rebuild(before.employeeId, date, user, tx) : null;
    });
    await this.audit.record({
      userId: user.id,
      action: dto.decision === 'reject' ? 'reject' : 'approve',
      entityType: CORRECTION_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, date, stage, decision: dto.decision, status: { from: before.status, to }, ...(comment && { comment }) },
    });
    if (change) await this.applied(before.employeeId, date, id, change, user);
    // to the next step's decider, or the employee once it is approved or rejected (Phase 4: notifications)
    await this.notices.correction(id, 'decided');
    return this.one(id, user);
  }

  // ---------- a person's month ----------

  /** A person's corrections of a month, by day, for their attendance page (the caller sees the page already). */
  async ofMonth(employeeId: string, month: string): Promise<MonthCorrection[]> {
    const rows = await this.prisma.attendanceCorrection.findMany({
      where: { employeeId, date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, date: true, kind: true, status: true, checkIn: true, checkOut: true },
    });
    return rows.map((r) => ({
      id: r.id,
      date: fromDateOnly(r.date),
      correctionKind: r.kind,
      status: r.status as LeaveStatus,
      checkIn: r.checkIn?.toISOString() ?? null,
      checkOut: r.checkOut?.toISOString() ?? null,
    }));
  }

  /** Whether the month's days can be corrected now: not once its payroll is approved or paid. */
  async monthCorrectable(month: string): Promise<MonthCorrectable> {
    const status = await this.runStatus(`${month}-01`);
    const reason = status === 'approved' || status === 'paid' ? correctionApplyRefusal(`${month}-01`, status) : null;
    return { allowed: !reason, reason };
  }

  // ---------- helpers ----------

  /** The caller, with their own employee profile and the C-level people. */
  private async caller(user: SessionUser): Promise<Caller> {
    const [me, confidential] = await Promise.all([this.confidential.selfId(user), this.confidential.view(user)]);
    return { user, employeeId: me, confidential };
  }

  /** The status of the month's payroll run a day is in; none: no run. */
  private async runStatus(date: string, db: Db = this.prisma): Promise<string | null> {
    const run = await db.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(date.slice(0, 7))) }, select: { status: true } });
    return run?.status ?? null;
  }

  /**
   * A correction saved, checked with the day as it is shown now, in a transaction holding the employee's row: an
   * employee's to the person in charge (or HR), HR's approved at once and applied.
   */
  private async submit(employeeId: string, dto: CreateCorrectionDto, caller: Caller, byHr: boolean): Promise<string> {
    const user = caller.user;
    const employment = await this.prisma.employment.findFirst({
      where: { employeeId, joinDate: { lte: toDateOnly(dto.date) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(dto.date) } }] },
      orderBy: { joinDate: 'desc' },
      select: { id: true, employmentType: true, managerId: true, departmentId: true, employee: { select: { fullNameEn: true } } },
    });
    const name = byHr ? (employment?.employee.fullNameEn ?? null) : null;
    if (!employment) {
      throw new BadRequestException([byHr ? 'Choose a day within one of their employments.' : 'You had no employment on that day, so there is no attendance of yours to correct.']);
    }
    if (employment.employmentType === 'freelance') {
      throw new BadRequestException([`${name ? `${name} works` : 'You work'} freelance: freelance work is outside the labour law and its working hours, so there is no attendance to correct.`]);
    }
    const approver = byHr ? null : await approverFor(this.prisma, { employeeId, managerId: employment.managerId, departmentId: employment.departmentId });
    const status: LeaveStatus = byHr ? 'approved' : firstLeaveStatus(!!approver);
    const date = dto.date;
    const month = date.slice(0, 7);

    const { id, change } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const [person, open, runStatus] = await Promise.all([
        this.days.monthOf(month, [employeeId], undefined, tx).then((m) => m.get(employeeId)),
        tx.attendanceCorrection.count({ where: { employeeId, date: toDateOnly(date), status: { in: ['with_manager', 'with_hr'] } } }),
        this.runStatus(date, tx),
      ]);
      const shown = person?.days.find((d) => d.date === date) ?? null;
      const day: CorrectableDay | null = shown && { ...shown };
      const shift = person?.employment?.shift ? shiftTimesOf(person.employment.shift) : null;
      const problems = correctionProblems(dto, { today: todayInCairo(), runStatus, day, shift, open: open > 0, name });
      if (!problems.length && byHr) {
        const refusal = correctionApplyRefusal(date, runStatus);
        if (refusal) problems.push(refusal);
      }
      if (problems.length) throw new BadRequestException(problems);
      const moments = correctionMoments(date, dto, day, shift);
      const dayBefore: DayBefore | null = shown
        ? { status: shown.status, checkIn: shown.checkIn, checkOut: shown.checkOut, place: shown.place, source: shown.source, ...(shown.pairs && { pairs: [...shown.pairs], openAt: shown.openAt ?? null }) }
        : null;
      const made = await tx.attendanceCorrection.create({
        data: {
          employeeId,
          employmentId: employment.id,
          date: toDateOnly(date),
          kind: dto.kind,
          checkIn: moments.checkIn ? new Date(moments.checkIn) : null,
          checkOut: moments.checkOut ? new Date(moments.checkOut) : null,
          reason: dto.reason!.trim(),
          dayBefore: dayBefore ? json(dayBefore) : Prisma.DbNull,
          status,
          managerId: approver?.employeeId ?? null,
          approverRole: approver?.role ?? null,
          recordedByHr: byHr,
          appliedAt: byHr ? new Date() : null,
          createdById: user.id,
        },
        select: { id: true },
      });
      if (byHr) await this.step(tx, made.id, user.id, { kind: 'recorded_by_hr' });
      else {
        await this.step(tx, made.id, user.id, { kind: 'submitted' });
        if (!approver) await this.step(tx, made.id, null, { kind: 'no_manager' });
      }
      return { id: made.id, change: byHr ? await this.correctionDays.rebuild(employeeId, date, user, tx) : null };
    });
    const saved = await this.prisma.attendanceCorrection.findUniqueOrThrow({ where: { id }, select: { kind: true, checkIn: true, checkOut: true, reason: true, managerId: true, approverRole: true } });
    await this.audit.record({
      userId: user.id,
      action: byHr ? 'record' : 'create',
      entityType: CORRECTION_ENTITY,
      entityId: id,
      diff: {
        employeeId,
        date,
        kind: saved.kind,
        checkIn: saved.checkIn?.toISOString() ?? null,
        checkOut: saved.checkOut?.toISOString() ?? null,
        reason: saved.reason,
        managerId: saved.managerId,
        approverRole: saved.approverRole,
        status,
      },
    });
    if (change) await this.applied(employeeId, date, id, change, user);
    return id;
  }

  /** Once the day is changed: its change in the audit log, and the month's draft payroll line refilled. */
  private async applied(employeeId: string, date: string, correctionId: string, change: Awaited<ReturnType<CorrectionDaysService['rebuild']>>, user: SessionUser) {
    await this.audit.record({
      userId: user.id,
      action: 'correct',
      entityType: DAY_ENTITY,
      entityId: change.dayId,
      diff: {
        employeeId,
        date,
        correctionId,
        from: change.before && { source: change.before.source, status: change.before.status, checkIn: change.before.checkIn, checkOut: change.before.checkOut, place: change.before.place },
        to: change.after && { checkIn: change.after.checkIn, checkOut: change.after.checkOut, place: change.after.place, hoursCounted: change.after.hoursCounted },
      },
    });
    await this.fill.fillMonth(employeeId, date.slice(0, 7), user);
  }

  /** Logs a step on a correction, in the transaction the step is taken in. */
  private async step(db: Db, correctionId: string, actorId: string | null, step: { kind: string; decision?: string; comment?: string | null }) {
    await db.attendanceCorrectionStep.create({ data: { correctionId, actorId, kind: step.kind, decision: step.decision ?? null, comment: step.comment ?? null } });
  }

  /** A correction the caller may see; otherwise it isn't there. */
  private async visible(id: string, caller: Caller): Promise<CorrectionRow> {
    const row = await this.prisma.attendanceCorrection.findUnique({ where: { id }, include: CORRECTION_INCLUDE });
    if (!row || !seesRequest(correctionParties(row), caller)) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** The corrections as the caller sees them, with who took each step; a C-level person's for the manager it went to. */
  private async views(rows: readonly CorrectionRow[], caller: Caller): Promise<AttendanceCorrectionView[]> {
    if (!rows.length) return [];
    const names = await userNames(this.prisma, rows.flatMap((r) => r.steps.map((s) => s.actor)));
    return rows.filter((r) => !hiddenRequest(r, caller) || isRequestManager(r, caller) || isRequester(r, caller)).map((r) => correctionView(r, caller, names));
  }
}
