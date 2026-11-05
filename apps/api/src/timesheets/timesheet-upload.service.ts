import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  TIMESHEET_LIMITS,
  TIMESHEET_TEMPLATE_NAME,
  timesheetEditable,
  timesheetEntryProblems,
  timesheetHoursText,
  timesheetRefusal,
  timesheetWeekOf,
  timesheetWeekText,
  totalHours,
  uploadProblemsShown,
  type TimesheetEntryInput,
  type TimesheetStatus,
  type TimesheetUploadResult,
  type TimesheetUploadWeek,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { NoticesService } from '../notifications/notices.service.js';
import { approverFor } from '../organisation/departments/leads.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CHOOSE_HOURS_FILE, readHoursFile, TimesheetFileError, type ReadHoursRow } from './timesheet-upload-file.js';
import { timesheetUploadTemplate } from './timesheet-upload-template.js';

// Uploading hours from a file (owner, 5 November 2026: "how to upload a bulk time log?"; asked, "Our own Excel
// template", "each person and HR", HR's "Sent to the approver"; packages/shared timesheets.ts). The template (the active
// clients and the employees whose codes go in it), and the upload: its rows checked one by one (the day, the code, the
// client or task, the hours, the note) and by week (a day's 24 hours, a week's lines, a week that can still change), then
// put into the weeks they fall in, each week's lines replaced by the file's, all in one transaction; nothing is saved
// while any row has a problem, each said by its row. Someone on timesheets uploads their own, saved or saved and sent;
// HR, the CEO or a Super Admin anyone's they see (a C-level person only by those who see them) on timesheets, each week
// sent to whoever approves it, who is told, and the uploader's direct manager told of the change made by hand. Each week
// in the audit log as typed weeks are.

const ENTITY = 'timesheet_week';
/** Who uploads for others: those who read everyone's timesheets. */
export const UPLOADS_FOR_OTHERS = ['hr', 'ceo', 'super_admin'] as const;

const JOB = { id: true, joinDate: true, endDate: true, managerId: true, departmentId: true, worksOnTimesheets: true } satisfies Prisma.EmploymentSelect;
type Job = Prisma.EmploymentGetPayload<{ select: typeof JOB }>;
const PERSON = { id: true, fullNameEn: true, employeeCode: true } satisfies Prisma.EmployeeSelect;
type Person = Prisma.EmployeeGetPayload<{ select: typeof PERSON }>;

/** A person's rows, their clients found. */
interface PersonRows {
  person: Person;
  job: Job;
  rows: { row: ReadHoursRow; date: string; clientAccountId: string | null; hours: number }[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const hoursOf = (d: Prisma.Decimal | number) => (typeof d === 'number' ? d : d.toNumber());

@Injectable()
export class TimesheetUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
  ) {}

  /** Whether the caller uploads for others (HR, the CEO, a Super Admin). */
  forOthers(user: SessionUser): boolean {
    return UPLOADS_FOR_OTHERS.some((r) => user.roles.includes(r));
  }

  // ---------- the template ----------

  /** The template for the caller: HR's with those on timesheets they see; anyone else's with themselves (refused when they don't log hours). */
  async template(user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const forOthers = this.forOthers(user);
    let people: { employeeCode: string; fullNameEn: string }[];
    if (forOthers) {
      const hidden = await this.confidential.hiddenFrom(user);
      const today = toDateOnly(todayInCairo());
      const rows = await this.prisma.employee.findMany({
        where: {
          ...(hidden.length && { id: { notIn: hidden } }),
          employments: { some: { worksOnTimesheets: true, joinDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] } },
        },
        orderBy: { fullNameEn: 'asc' },
        select: PERSON,
      });
      people = rows.map((p) => ({ employeeCode: p.employeeCode!, fullNameEn: p.fullNameEn }));
    } else {
      const { person } = await this.own(user);
      people = person.employeeCode ? [{ employeeCode: person.employeeCode, fullNameEn: person.fullNameEn }] : [];
    }
    const clients = await this.prisma.clientAccount.findMany({ where: { status: 'active' }, orderBy: { nameEn: 'asc' }, select: { nameEn: true, code: true } });
    const data = await timesheetUploadTemplate({ clients: clients.map((c) => ({ name: c.nameEn, code: c.code })), people, forOthers, year: Number(todayInCairo().slice(0, 4)) });
    return { fileName: TIMESHEET_TEMPLATE_NAME, data };
  }

  // ---------- uploading ----------

  /** The caller's own hours: each week saved (with `send`, sent to whoever approves it too). */
  async uploadMine(file: Express.Multer.File | undefined, send: boolean, user: SessionUser): Promise<TimesheetUploadResult> {
    const { person, job } = await this.own(user);
    const rows = await this.read(file);
    const clients = await this.clientIndex();
    const problems: string[] = [];
    const mine: PersonRows = { person, job, rows: [] };
    for (const row of rows) {
      if (row.code && (!person.employeeCode || norm(row.code) !== norm(person.employeeCode))) {
        problems.push(`Row ${row.row}: ${row.code} isn’t your employee code. The file can have only your own hours: leave Employee code empty or write your own.`);
        continue;
      }
      const ok = this.checkRow(row, job, clients, problems);
      if (ok) mine.rows.push(ok);
    }
    return this.apply([mine], { send, user, forOthers: false, problems });
  }

  /** Anyone's hours the caller sees, by their codes: each person's weeks saved and sent to whoever approves them. */
  async uploadForOthers(file: Express.Multer.File | undefined, user: SessionUser): Promise<TimesheetUploadResult> {
    const rows = await this.read(file);
    const clients = await this.clientIndex();
    const problems: string[] = [];
    const codes = [...new Set(rows.map((r) => r.code).filter((c): c is string => !!c).map(norm))];
    const hidden = new Set(await this.confidential.hiddenFrom(user));
    const found = codes.length
      ? await this.prisma.employee.findMany({ where: { OR: codes.map((c) => ({ employeeCode: { equals: c, mode: 'insensitive' as const } })) }, select: PERSON })
      : [];
    const byCode = new Map(found.filter((p) => !hidden.has(p.id) && p.employeeCode).map((p) => [norm(p.employeeCode!), p]));
    const jobs = await this.currentJobs([...byCode.values()].map((p) => p.id));
    const people = new Map<string, PersonRows>();
    const notOnTimesheets = new Set<string>();
    for (const row of rows) {
      if (!row.code) {
        problems.push(`Row ${row.row}: write the employee code (listed on How to fill).`);
        continue;
      }
      const person = byCode.get(norm(row.code));
      if (!person) {
        problems.push(`Row ${row.row}: there is no employee with the code ${row.code}.`);
        continue;
      }
      const job = jobs.get(person.id);
      if (!job || !job.worksOnTimesheets) {
        // said once a person, at their first row
        if (!notOnTimesheets.has(person.id)) {
          notOnTimesheets.add(person.id);
          problems.push(
            job
              ? `Row ${row.row}: ${person.fullNameEn} (${person.employeeCode}) isn’t switched to timesheets: tick Works on timesheets on their employment first.`
              : `Row ${row.row}: ${person.fullNameEn} (${person.employeeCode}) has no current employment.`,
          );
        }
        continue;
      }
      const ok = this.checkRow(row, job, clients, problems);
      if (!ok) continue;
      const entry = people.get(person.id) ?? { person, job, rows: [] };
      people.set(person.id, entry);
      entry.rows.push(ok);
    }
    return this.apply([...people.values()], { send: true, user, forOthers: true, problems });
  }

  // ---------- the checks ----------

  /** A row's own problems, each by its row number; the row as it will be saved when it has none. */
  private checkRow(row: ReadHoursRow, job: Job, clients: Map<string, string>, problems: string[]): PersonRows['rows'][number] | null {
    const at = `Row ${row.row}:`;
    const before = problems.length;
    const today = todayInCairo();
    if (!row.date) problems.push(row.dateText ? `${at} “${row.dateText}” isn’t a day. Write the date as DD/MM/YYYY, e.g. 02/11/2026.` : `${at} write the date.`);
    else if (row.date > today) problems.push(`${at} ${shownDate(row.date)} hasn’t come yet: log hours once they are worked.`);
    else if (row.date < fromDateOnly(job.joinDate) || (job.endDate && row.date > fromDateOnly(job.endDate))) problems.push(`${at} ${shownDate(row.date)} is outside the employment.`);
    if (row.hours === null) {
      problems.push(row.hoursText ? `${at} “${row.hoursText}” isn’t hours. Enter them from 0.25 to 24 in quarter hours, e.g. 1.5, 7.75 or 7:45.` : `${at} enter the hours.`);
    }
    let clientAccountId: string | null = null;
    if (row.client) {
      clientAccountId = clients.get(norm(row.client)) ?? null;
      if (!clientAccountId) problems.push(`${at} “${row.client}” isn’t an active client. Choose it from the list (on How to fill), or leave Client empty and write the Task.`);
    } else if (!row.task) {
      problems.push(`${at} choose the client, or write the task.`);
    }
    if (row.task && row.task.length > TIMESHEET_LIMITS.task) problems.push(`${at} keep the task to ${TIMESHEET_LIMITS.task} characters or fewer.`);
    if (row.note && row.note.length > TIMESHEET_LIMITS.note) problems.push(`${at} keep the note to ${TIMESHEET_LIMITS.note} characters or fewer.`);
    if (problems.length > before) return null;
    return { row, date: row.date!, clientAccountId, hours: row.hours! };
  }

  /**
   * The weeks checked (a day's 24 hours, a week's lines, a week that can still change), then all saved in one
   * transaction, each week's lines replaced by the file's (with `send`, sent to whoever approves it); every problem said
   * and nothing saved when there is any.
   */
  private async apply(people: readonly PersonRows[], opts: { send: boolean; user: SessionUser; forOthers: boolean; problems: string[] }): Promise<TimesheetUploadResult> {
    const { problems } = opts;
    const today = todayInCairo();
    // each person's rows by week
    const groups = people.flatMap((p) => {
      const weeks = new Map<string, PersonRows['rows']>();
      for (const r of p.rows) {
        const w = timesheetWeekOf(r.date);
        weeks.set(w, [...(weeks.get(w) ?? []), r]);
      }
      return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, rows]) => ({ ...p, weekStart, rows }));
    });
    const existing = groups.length
      ? await this.prisma.timesheetWeek.findMany({
          where: { OR: groups.map((g) => ({ employeeId: g.person.id, weekStart: toDateOnly(g.weekStart) })) },
          select: { id: true, employeeId: true, weekStart: true, status: true, entries: { select: { hours: true } } },
        })
      : [];
    const weekOf = (employeeId: string, weekStart: string) => existing.find((w) => w.employeeId === employeeId && fromDateOnly(w.weekStart) === weekStart) ?? null;

    for (const g of groups) {
      const label = opts.forOthers ? `${g.person.fullNameEn}, week of ${timesheetWeekText(g.weekStart)}:` : `Week of ${timesheetWeekText(g.weekStart)}:`;
      const before = weekOf(g.person.id, g.weekStart);
      if (before && !timesheetEditable(before.status as TimesheetStatus)) {
        problems.push(
          before.status === 'approved'
            ? `${label} approved already, so its hours stay as they are. Leave its rows out.`
            : `${label} waiting for approval already, so it can’t be changed now. Leave its rows out.`,
        );
        continue;
      }
      const perDay = new Map<string, number>();
      for (const r of g.rows) perDay.set(r.date, (perDay.get(r.date) ?? 0) + r.hours);
      for (const [date, h] of [...perDay.entries()].sort()) {
        if (h > TIMESHEET_LIMITS.hoursPerDay) problems.push(`${label} ${shownDate(date)} has ${timesheetHoursText(h)}: a day has 24 hours at most.`);
      }
      if (g.rows.length > TIMESHEET_LIMITS.entriesPerWeek) problems.push(`${label} keep a week to ${TIMESHEET_LIMITS.entriesPerWeek} lines or fewer.`);
      // the rules the typed weeks keep, once more (the rows were checked one by one already)
      if (!problems.length) {
        const more = timesheetEntryProblems(this.entries(g.rows), {
          weekStart: g.weekStart,
          today,
          employedFrom: fromDateOnly(g.job.joinDate),
          employedTo: g.job.endDate ? fromDateOnly(g.job.endDate) : null,
        });
        problems.push(...more.map((m) => `${label} ${m}`));
      }
    }
    if (problems.length) throw new BadRequestException(uploadProblemsShown(problems));

    // whoever approves each person's weeks, read now as a typed week's sending reads it
    const approvers = new Map<string, string | null>();
    if (opts.send) {
      for (const p of people) {
        const a = await approverFor(this.prisma, { employeeId: p.person.id, managerId: p.job.managerId, departmentId: p.job.departmentId });
        approvers.set(p.person.id, a?.employeeId ?? null);
      }
    }

    const now = new Date();
    const saved = await this.prisma.$transaction(
      async (tx) => {
        const out: { g: (typeof groups)[number]; id: string; replaced: number; hoursBefore: number; status: TimesheetStatus }[] = [];
        for (const g of groups) {
          const before = weekOf(g.person.id, g.weekStart);
          const status: TimesheetStatus = opts.send ? 'submitted' : before?.status === 'rejected' ? 'rejected' : 'draft';
          const sending = opts.send ? { submittedAt: now, approverId: approvers.get(g.person.id) ?? null, decidedAt: null, decidedById: null } : {};
          let id: string;
          if (before) {
            // only while it can still change: a week sent or decided meanwhile stops the upload
            const { count } = await tx.timesheetWeek.updateMany({ where: { id: before.id, status: { in: ['draft', 'rejected'] } }, data: { status, ...sending } });
            if (!count) throw new ConflictException(`${g.person.fullNameEn}, week of ${timesheetWeekText(g.weekStart)}: it changed meanwhile. Upload the file again.`);
            id = before.id;
            await tx.timesheetEntry.deleteMany({ where: { weekId: id } });
          } else {
            id = (await tx.timesheetWeek.create({ data: { employeeId: g.person.id, weekStart: toDateOnly(g.weekStart), status, ...sending }, select: { id: true } })).id;
          }
          await tx.timesheetEntry.createMany({
            data: this.entries(g.rows).map((e) => ({
              weekId: id,
              date: toDateOnly(e.date),
              clientAccountId: e.clientAccountId ?? null,
              task: e.task ?? null,
              hours: new Prisma.Decimal(e.hours),
              note: e.note ?? null,
            })),
          });
          out.push({ g, id, replaced: before?.entries.length ?? 0, hoursBefore: totalHours((before?.entries ?? []).map((e) => ({ hours: hoursOf(e.hours) }))), status });
        }
        return out;
      },
      { timeout: 60_000 },
    );

    for (const s of saved) {
      const lines = this.entries(s.g.rows);
      await this.audit.record({
        userId: opts.user.id,
        action: 'update',
        entityType: ENTITY,
        entityId: s.id,
        diff: { employeeId: s.g.person.id, weekStart: s.g.weekStart, hours: { from: s.hoursBefore, to: totalHours(lines) }, lines: lines.length, uploaded: true },
      });
      if (opts.send) {
        await this.audit.record({ userId: opts.user.id, action: 'submit', entityType: ENTITY, entityId: s.id, diff: { employeeId: s.g.person.id, weekStart: s.g.weekStart, approverId: approvers.get(s.g.person.id) ?? null } });
        await this.notices.timesheetSent(s.id);
      }
    }
    if (opts.forOthers) {
      await this.notices.timesheetsUploaded(
        opts.user.id,
        people.map((p) => ({ employeeId: p.person.id, name: p.person.fullNameEn, weeks: saved.filter((s) => s.g.person.id === p.person.id).map((s) => ({ id: s.id, weekStart: s.g.weekStart })) })),
      );
    }

    const weeks: TimesheetUploadWeek[] = saved.map((s) => ({
      id: s.id,
      employee: { id: s.g.person.id, fullNameEn: s.g.person.fullNameEn, employeeCode: s.g.person.employeeCode },
      weekStart: s.g.weekStart,
      lines: s.g.rows.length,
      totalHours: totalHours(s.g.rows),
      status: s.status,
      replaced: s.replaced,
    }));
    return { weeks, lines: weeks.reduce((n, w) => n + w.lines, 0), totalHours: totalHours(weeks.map((w) => ({ hours: w.totalHours }))), sent: opts.send };
  }

  /** A week's rows as lines, in the file's order. */
  private entries(rows: PersonRows['rows']): (TimesheetEntryInput & { clientAccountId: string | null; task: string | null; note: string | null })[] {
    return rows.map((r) => ({ date: r.date, clientAccountId: r.clientAccountId, task: r.row.task, hours: r.hours, note: r.row.note }));
  }

  // ---------- reading ----------

  /** The file's rows; a file that can't be read refused in words. */
  private async read(file: Express.Multer.File | undefined): Promise<ReadHoursRow[]> {
    if (!file?.buffer?.length) throw new BadRequestException(CHOOSE_HOURS_FILE);
    try {
      return await readHoursFile(file.buffer);
    } catch (err) {
      if (err instanceof TimesheetFileError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** The active clients by their name and their code (as written, any case). */
  private async clientIndex(): Promise<Map<string, string>> {
    const rows = await this.prisma.clientAccount.findMany({ where: { status: 'active' }, select: { id: true, nameEn: true, code: true } });
    const index = new Map<string, string>();
    for (const c of rows) index.set(norm(c.nameEn), c.id);
    // a code never shadows a name
    for (const c of rows) if (c.code && !index.has(norm(c.code))) index.set(norm(c.code), c.id);
    return index;
  }

  /** The caller's profile and current employment: refused in words when they don't log hours. */
  private async own(user: SessionUser): Promise<{ person: Person; job: Job }> {
    const selfId = await this.confidential.selfId(user);
    const job = selfId ? ((await this.currentJobs([selfId])).get(selfId) ?? null) : null;
    const refusal = timesheetRefusal(!!selfId, job);
    if (refusal) throw new ForbiddenException(refusal);
    const person = await this.prisma.employee.findUniqueOrThrow({ where: { id: selfId! }, select: PERSON });
    return { person, job: job! };
  }

  /** Each person's employment covering today (the latest when two do). */
  private async currentJobs(employeeIds: readonly string[]): Promise<Map<string, Job>> {
    if (!employeeIds.length) return new Map();
    const today = toDateOnly(todayInCairo());
    const rows = await this.prisma.employment.findMany({
      where: { employeeId: { in: [...employeeIds] }, joinDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      orderBy: { joinDate: 'desc' },
      select: { ...JOB, employeeId: true },
    });
    const out = new Map<string, Job>();
    for (const r of rows) if (!out.has(r.employeeId)) out.set(r.employeeId, r);
    return out;
  }
}
