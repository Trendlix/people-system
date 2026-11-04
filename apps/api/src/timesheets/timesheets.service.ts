import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  decidesConfidentialStage,
  isTimesheetStatus,
  timesheetEditable,
  timesheetEntryProblems,
  timesheetRefusal,
  timesheetSubmitProblem,
  timesheetWeekDays,
  timesheetWeekOf,
  timesheetWeekShift,
  totalHours,
  type MyTimesheetView,
  type TimesheetClientOption,
  type TimesheetListItem,
  type TimesheetStatus,
  type TimesheetWeekView,
} from '@trendlix/shared';
import { AttendanceFillService } from '../attendance/attendance-fill.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { NoticesService } from '../notifications/notices.service.js';
import { approverFor } from '../organisation/departments/leads.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { DecideTimesheetDto, ListTimesheetsDto, SaveTimesheetDto } from './timesheets.dto.js';

// Timesheets (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly", "Full salary, hours
// tracked", "Only those HR switches on"; packages/shared timesheets.ts). Someone whose current employment works on
// timesheets keeps a week of lines (a day, a client account or a task, the hours, a note) while it isn't sent (or after
// it is rejected), and sends it; the one who approves their leave (approverFor, read when it is sent: the direct manager,
// else the team's lead, else the department's head) approves it or rejects it with why; with nobody, HR (the CEO for a
// C-level person). A Super Admin decides any; nobody their own. An approved week's hours fill the month's draft payroll
// line of someone paid by the hour (attendance-fill.service.ts). HR and the CEO read everyone's (a C-level person's only
// by those who see them); an approver the weeks sent to them; the person their own. Everything audited.

const ENTITY = 'timesheet_week';
const NOT_FOUND = 'Timesheet not found.';

const WEEK_INCLUDE = {
  employee: { select: { id: true, fullNameEn: true, employeeCode: true } },
  approver: { select: { id: true, fullNameEn: true } },
  decidedBy: { select: { email: true, employee: { select: { fullNameEn: true } } } },
  entries: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], include: { clientAccount: { select: { id: true, nameEn: true } } } },
} satisfies Prisma.TimesheetWeekInclude;

type WeekRow = Prisma.TimesheetWeekGetPayload<{ include: typeof WEEK_INCLUDE }>;

/** The current employment as timesheets need it. */
const JOB = { id: true, joinDate: true, endDate: true, managerId: true, departmentId: true, worksOnTimesheets: true } satisfies Prisma.EmploymentSelect;
type Job = Prisma.EmploymentGetPayload<{ select: typeof JOB }>;

const hours = (d: Prisma.Decimal | number) => (typeof d === 'number' ? d : d.toNumber());

@Injectable()
export class TimesheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
    private readonly fill: AttendanceFillService,
  ) {}

  // ---------- one's own ----------

  /** The caller's week (any day of it; none: this week), the clients to pick, and the weeks before not sent yet. */
  async mine(week: string | undefined, user: SessionUser): Promise<MyTimesheetView> {
    const selfId = await this.confidential.selfId(user);
    const weekStart = timesheetWeekOf(week ?? todayInCairo());
    const job = selfId ? await this.currentJob(selfId) : null;
    const refusal = timesheetRefusal(!!selfId, job);
    const person = selfId ? await this.prisma.employee.findUnique({ where: { id: selfId }, select: { id: true, fullNameEn: true, employeeCode: true } }) : null;
    const row = selfId ? await this.prisma.timesheetWeek.findUnique({ where: { employeeId_weekStart: { employeeId: selfId, weekStart: toDateOnly(weekStart) } }, include: WEEK_INCLUDE }) : null;
    const [clients, unsent] = await Promise.all([refusal ? [] : this.clientsFor(selfId!), refusal ? [] : this.unsentBefore(selfId!, weekStart)]);
    const view = row ? this.view(row, user, selfId) : this.emptyWeek(person ?? { id: selfId ?? '', fullNameEn: '', employeeCode: null }, weekStart, !refusal);
    return { ...view, can: { ...view.can, edit: view.can.edit && !refusal, submit: view.can.submit && !refusal }, refusal, clients, unsent };
  }

  /** Saves the week's lines (all of them: what is sent replaces what was), while it isn't sent or after it is rejected. */
  async saveMine(week: string | undefined, dto: SaveTimesheetDto, user: SessionUser): Promise<MyTimesheetView> {
    const { selfId, job, weekStart } = await this.ownWeek(week, user);
    const today = todayInCairo();
    const problems = timesheetEntryProblems(dto.entries, { weekStart, today, employedFrom: fromDateOnly(job.joinDate), employedTo: fromDateOnly(job.endDate) });
    if (problems.length) throw new BadRequestException(problems);
    await this.checkClients(dto.entries.map((e) => e.clientAccountId ?? null));
    const before = await this.prisma.timesheetWeek.findUnique({ where: { employeeId_weekStart: { employeeId: selfId, weekStart: toDateOnly(weekStart) } }, include: { entries: true } });
    if (before && !timesheetEditable(before.status as TimesheetStatus)) {
      throw new ConflictException(before.status === 'approved' ? 'This week is approved: its hours stay as they are.' : 'This week is waiting for approval: it can’t be changed now.');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      // a rejected week corrected goes back to not sent; its reason stays until it is sent again
      const saved = before
        ? await tx.timesheetWeek.update({ where: { id: before.id }, data: { status: before.status === 'rejected' ? 'rejected' : 'draft' }, select: { id: true } })
        : await tx.timesheetWeek.create({ data: { employeeId: selfId, weekStart: toDateOnly(weekStart), status: 'draft' }, select: { id: true } });
      await tx.timesheetEntry.deleteMany({ where: { weekId: saved.id } });
      if (dto.entries.length) {
        await tx.timesheetEntry.createMany({
          data: dto.entries.map((e) => ({
            weekId: saved.id,
            date: toDateOnly(e.date),
            clientAccountId: e.clientAccountId ?? null,
            task: e.task?.trim() || null,
            hours: new Prisma.Decimal(e.hours),
            note: e.note?.trim() || null,
          })),
        });
      }
      return saved.id;
    });
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeId: selfId, weekStart, hours: { from: before ? totalHours(before.entries.map((e) => ({ hours: hours(e.hours) }))) : 0, to: totalHours(dto.entries) }, lines: dto.entries.length },
    });
    return this.mine(weekStart, user);
  }

  /** Sends the week to the one who approves it (read now), who is told; refused in words when it can't be. */
  async submitMine(week: string | undefined, user: SessionUser): Promise<MyTimesheetView> {
    const { selfId, job, weekStart } = await this.ownWeek(week, user);
    const before = await this.prisma.timesheetWeek.findUnique({ where: { employeeId_weekStart: { employeeId: selfId, weekStart: toDateOnly(weekStart) } }, select: { id: true, status: true, _count: { select: { entries: true } } } });
    const problem = timesheetSubmitProblem((before?.status as TimesheetStatus) ?? null, before?._count.entries ?? 0);
    if (problem) throw new ConflictException(problem);
    const approver = await approverFor(this.prisma, { employeeId: selfId, managerId: job.managerId, departmentId: job.departmentId });
    const { count } = await this.prisma.timesheetWeek.updateMany({
      where: { id: before!.id, status: { in: ['draft', 'rejected'] } },
      data: { status: 'submitted', submittedAt: new Date(), approverId: approver?.employeeId ?? null, decidedAt: null, decidedById: null },
    });
    if (!count) throw new ConflictException('This week changed meanwhile: open it again.');
    await this.audit.record({ userId: user.id, action: 'submit', entityType: ENTITY, entityId: before!.id, diff: { employeeId: selfId, weekStart, approverId: approver?.employeeId ?? null } });
    await this.notices.timesheetSent(before!.id);
    return this.mine(weekStart, user);
  }

  // ---------- deciding and reading them ----------

  /** The weeks the caller may read: HR and the CEO everyone's (C-level as they see them), others those sent to them. */
  async list(query: ListTimesheetsDto, user: SessionUser): Promise<TimesheetListItem[]> {
    const selfId = await this.confidential.selfId(user);
    const status = query.status ?? 'waiting';
    const reads = this.readsAll(user);
    const hidden = reads ? await this.confidential.hiddenFrom(user) : [];
    const where: Prisma.TimesheetWeekWhereInput = {
      AND: [
        query.employeeId ? { employeeId: query.employeeId } : {},
        query.week ? { weekStart: toDateOnly(timesheetWeekOf(query.week)) } : {},
        status === 'waiting' ? { status: 'submitted' } : status === 'all' ? { status: { not: 'draft' } } : { status },
        // HR and the CEO: everyone's but the C-level people hidden from them; anyone else: those sent to them
        reads ? (hidden.length ? { employeeId: { notIn: hidden } } : {}) : selfId ? { approverId: selfId } : { id: { in: [] } },
      ],
    };
    const rows = await this.prisma.timesheetWeek.findMany({ where, orderBy: [{ weekStart: 'desc' }, { submittedAt: 'asc' }], include: WEEK_INCLUDE, take: 500 });
    const items = await Promise.all(rows.map(async (r) => ({ r, waiting: await this.waitsFor(r, user, selfId) })));
    return items
      .filter(({ waiting }) => status !== 'waiting' || waiting)
      .map(({ r, waiting }) => ({
        id: r.id,
        employee: { id: r.employee.id, fullNameEn: r.employee.fullNameEn, employeeCode: r.employee.employeeCode },
        weekStart: fromDateOnly(r.weekStart),
        weekEnd: timesheetWeekDays(fromDateOnly(r.weekStart))[6],
        status: r.status as TimesheetStatus,
        totalHours: totalHours(r.entries.map((e) => ({ hours: hours(e.hours) }))),
        submittedAt: r.submittedAt?.toISOString() ?? null,
        waitingForYou: waiting,
      }));
  }

  /** One week, for whoever may read it; anyone else is told it isn't there. */
  async one(id: string, user: SessionUser): Promise<TimesheetWeekView> {
    const row = await this.prisma.timesheetWeek.findUnique({ where: { id }, include: WEEK_INCLUDE });
    const selfId = await this.confidential.selfId(user);
    if (!row || !(await this.mayRead(row, user, selfId))) throw new NotFoundException(NOT_FOUND);
    return this.viewFor(row, user, selfId);
  }

  /** Approves a week sent, or rejects it with why; its person told; an approved week's hours fill the month's draft line. */
  async decide(id: string, dto: DecideTimesheetDto, user: SessionUser): Promise<TimesheetWeekView> {
    const row = await this.prisma.timesheetWeek.findUnique({ where: { id }, include: WEEK_INCLUDE });
    const selfId = await this.confidential.selfId(user);
    if (!row || !(await this.mayRead(row, user, selfId))) throw new NotFoundException(NOT_FOUND);
    if (row.employeeId === selfId) throw new ForbiddenException('Someone else approves your timesheet.');
    if (row.status !== 'submitted') throw new ConflictException(row.status === 'approved' ? 'This week is approved already.' : 'This week isn’t waiting for approval.');
    if (!(await this.waitsFor(row, user, selfId))) throw new ForbiddenException(row.approver ? `${row.approver.fullNameEn} approves this week.` : 'HR approves this week.');
    const comment = dto.comment?.trim() || null;
    if (dto.decision === 'reject' && !comment) throw new BadRequestException(['Write why you reject it.']);
    const to = dto.decision === 'approve' ? 'approved' : 'rejected';
    const { count } = await this.prisma.timesheetWeek.updateMany({
      where: { id, status: 'submitted' },
      data: { status: to, decidedAt: new Date(), decidedById: user.id, rejectReason: to === 'rejected' ? comment : null },
    });
    if (!count) throw new ConflictException('This week was decided meanwhile.');
    await this.audit.record({ userId: user.id, action: dto.decision, entityType: ENTITY, entityId: id, diff: { employeeId: row.employeeId, weekStart: fromDateOnly(row.weekStart), status: { from: 'submitted', to }, ...(comment && { comment }) } });
    await this.notices.timesheetDecided(id);
    if (to === 'approved') {
      // the months its days fall in: their draft lines refilled (paid by the hour: the approved hours)
      const months = [...new Set(row.entries.map((e) => fromDateOnly(e.date).slice(0, 7)))];
      for (const m of months) await this.fill.fillMonth(row.employeeId, m, user);
    }
    return this.one(id, user);
  }

  // ---------- helpers ----------

  private readsAll(user: SessionUser): boolean {
    return user.roles.includes('hr') || user.roles.includes('ceo') || user.roles.includes('super_admin');
  }

  /** Whether the week waits for the caller's decision: its approver, or (none) HR / the CEO for a C-level person; a Super Admin any. Never their own. */
  private async waitsFor(r: Pick<WeekRow, 'status' | 'employeeId' | 'approverId'>, user: SessionUser, selfId: string | null): Promise<boolean> {
    if (r.status !== 'submitted' || r.employeeId === selfId) return false;
    if (user.roles.includes('super_admin')) return true;
    if (r.approverId) return r.approverId === selfId;
    return (await this.confidential.isConfidential(r.employeeId)) ? decidesConfidentialStage(user, ['hr']) : user.roles.includes('hr');
  }

  private async mayRead(r: Pick<WeekRow, 'status' | 'employeeId' | 'approverId'>, user: SessionUser, selfId: string | null): Promise<boolean> {
    if (r.employeeId === selfId) return true;
    if (r.status === 'draft') return false;
    if (r.approverId && r.approverId === selfId) return true;
    if (!this.readsAll(user)) return false;
    return !(await this.confidential.hiddenFrom(user)).includes(r.employeeId);
  }

  private async viewFor(row: WeekRow, user: SessionUser, selfId: string | null): Promise<TimesheetWeekView> {
    const view = this.view(row, user, selfId);
    const waiting = await this.waitsFor(row, user, selfId);
    return { ...view, waitingForYou: waiting, can: { ...view.can, decide: waiting } };
  }

  private view(row: WeekRow, _user: SessionUser, selfId: string | null): TimesheetWeekView {
    const weekStart = fromDateOnly(row.weekStart);
    const days = timesheetWeekDays(weekStart);
    const entries = row.entries.map((e) => ({
      id: e.id,
      date: fromDateOnly(e.date),
      client: e.clientAccount ? { id: e.clientAccount.id, name: e.clientAccount.nameEn } : null,
      task: e.task,
      hours: hours(e.hours),
      note: e.note,
    }));
    const status = isTimesheetStatus(row.status) ? row.status : 'draft';
    const own = row.employeeId === selfId;
    return {
      id: row.id,
      employee: { id: row.employee.id, fullNameEn: row.employee.fullNameEn, employeeCode: row.employee.employeeCode },
      weekStart,
      weekEnd: days[6],
      status,
      entries,
      totalHours: totalHours(entries),
      days: days.map((date) => ({ date, hours: totalHours(entries.filter((e) => e.date === date)) })),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedBy: row.decidedBy ? (row.decidedBy.employee?.fullNameEn ?? row.decidedBy.email) : null,
      rejectReason: row.rejectReason,
      approver: row.approver,
      waitingForYou: false,
      can: { edit: own && timesheetEditable(status), submit: own && !timesheetSubmitProblem(status, entries.length), decide: false },
    };
  }

  private emptyWeek(person: { id: string; fullNameEn: string; employeeCode: string | null }, weekStart: string, logs: boolean): TimesheetWeekView {
    const days = timesheetWeekDays(weekStart);
    return {
      id: null,
      employee: person,
      weekStart,
      weekEnd: days[6],
      status: null,
      entries: [],
      totalHours: 0,
      days: days.map((date) => ({ date, hours: 0 })),
      submittedAt: null,
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
      approver: null,
      waitingForYou: false,
      can: { edit: logs, submit: false, decide: false },
    };
  }

  private async currentJob(employeeId: string): Promise<Job | null> {
    const today = toDateOnly(todayInCairo());
    return this.prisma.employment.findFirst({ where: { employeeId, joinDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] }, orderBy: { joinDate: 'desc' }, select: JOB });
  }

  /** The caller's own week to change or send: refused in words when they don't log hours. */
  private async ownWeek(week: string | undefined, user: SessionUser): Promise<{ selfId: string; job: Job; weekStart: string }> {
    const selfId = await this.confidential.selfId(user);
    const job = selfId ? await this.currentJob(selfId) : null;
    const refusal = timesheetRefusal(!!selfId, job);
    if (refusal) throw new ForbiddenException(refusal);
    return { selfId: selfId!, job: job!, weekStart: timesheetWeekOf(week ?? todayInCairo()) };
  }

  /** The client accounts to pick: those they work on now first, then the other active ones, by name. */
  private async clientsFor(employeeId: string): Promise<TimesheetClientOption[]> {
    const today = toDateOnly(todayInCairo());
    const [accounts, mine] = await Promise.all([
      this.prisma.clientAccount.findMany({ where: { status: 'active' }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true } }),
      this.prisma.clientAccountAssignment.findMany({ where: { employeeId, fromDate: { lte: today }, OR: [{ toDate: null }, { toDate: { gte: today } }] }, select: { accountId: true } }),
    ]);
    const assigned = new Set(mine.map((a) => a.accountId));
    const options = accounts.map((a) => ({ id: a.id, name: a.nameEn, assigned: assigned.has(a.id) }));
    return [...options.filter((o) => o.assigned), ...options.filter((o) => !o.assigned)];
  }

  /** The client accounts the lines name: each must be an active one. */
  private async checkClients(ids: readonly (string | null)[]): Promise<void> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return;
    const found = await this.prisma.clientAccount.count({ where: { id: { in: wanted }, status: 'active' } });
    if (found !== wanted.length) throw new BadRequestException(['Choose each client from the list of active clients.']);
  }

  /** The weeks before this one (at most 8) still not sent, or rejected: their Sundays, newest first. */
  private async unsentBefore(employeeId: string, weekStart: string): Promise<string[]> {
    const rows = await this.prisma.timesheetWeek.findMany({
      where: { employeeId, status: { in: ['draft', 'rejected'] }, weekStart: { lt: toDateOnly(weekStart), gte: toDateOnly(timesheetWeekShift(weekStart, -8)) } },
      orderBy: { weekStart: 'desc' },
      select: { weekStart: true },
    });
    return rows.map((r) => fromDateOnly(r.weekStart));
  }
}
