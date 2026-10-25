import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  HOURS_CHANGE_KINDS,
  hoursSummary,
  INTERVIEW_DEFAULTS_STANDARD,
  interviewDefaultsProblems,
  interviewHoursProblems,
  tidyHours,
  type HoursChange,
  type InterviewDefaults,
  type InterviewDefaultsView,
  type InterviewerReason,
  type InterviewerRow,
  type InterviewersView,
  type InterviewHours,
  type InterviewHoursReminder,
  type InterviewHoursView,
  type InterviewKind,
  type MyInterviewHoursView,
  type MyUpcomingInterview,
  type WeeklyWindow,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { vacancyWhere } from '../recruitment/recruitment-access.js';
import type { InterviewDefaultsDto, InterviewHoursDto } from './interview-hours.dto.js';

// Interview hours (owner, 25 October 2026: "is it better for each interviewer to add his available interviews
// timeslots?"; recommended weekly interview hours set once, the conflicts taken away by the system; asked, "Hours +
// calendar"; packages/shared interview-availability.ts):
// - each person who interviews (anyone HR can put on a panel, and hiring managers: every current employee) sets theirs
//   once on their own Interview Hours page: the weekly ranges in Cairo, the day they count from, one-off changes (a day
//   off from interviews, extra hours on a date), and their own notice and buffer, only ever stricter than the company's;
// - HR, the CEO and a Super Admin set anyone's (a C-level person's only the CEO and a Super Admin: owner, 19 October
//   2026, "make C level Employees details not visible to HR"), and the company's defaults (24 hours' notice and 15
//   minutes between interviews, unless changed) on Organization → Interview Hours, with the list of who interviews;
// - the dashboard asks a hiring manager of an open vacancy, or someone on a panel to come, who has none: "Set your
//   interview hours so HR can book you".
// Saving no ranges and no changes clears them (none set again). Every change is audited.

export const INTERVIEW_HOURS_ENTITY = 'interview_hours';
export const INTERVIEW_SETTINGS_ENTITY = 'interview_settings';

/** Who sets anyone's hours and the company's defaults. */
const SETS_ANYONES = ['hr', 'ceo', 'super_admin'] as const;

const NO_PROFILE = 'Your account has no employee profile: interview hours are for the people who interview.';
const NOT_FOUND = 'Employee not found.';

/** A current employment: not ended before today. */
const CURRENT = (today: string): Prisma.EmployeeWhereInput => ({ employments: { some: { OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }] } } });

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** The ranges as a request or the database gives them: only their known fields (the rules check the rest). */
export function windowsOf(value: unknown): WeeklyWindow[] {
  return Array.isArray(value) ? value.filter(isObject).map((w) => ({ day: typeof w.day === 'number' ? w.day : Number.NaN, from: str(w.from) ?? '', to: str(w.to) ?? '' })) : [];
}

/** The one-off changes the same way. */
export function changesOf(value: unknown): HoursChange[] {
  return Array.isArray(value)
    ? value.filter(isObject).map((c) => ({
        date: str(c.date) ?? '',
        kind: (HOURS_CHANGE_KINDS as readonly string[]).includes(c.kind as string) ? (c.kind as HoursChange['kind']) : ('' as HoursChange['kind']),
        from: str(c.from),
        to: str(c.to),
      }))
    : [];
}

/** A saved row as InterviewHours. */
export const hoursOfRow = (r: { windows: unknown; changes: unknown; effectiveFrom: Date; noticeHours: number | null; bufferMinutes: number | null }): InterviewHours => ({
  windows: windowsOf(r.windows),
  changes: changesOf(r.changes),
  effectiveFrom: fromDateOnly(r.effectiveFrom),
  noticeHours: r.noticeHours,
  bufferMinutes: r.bufferMinutes,
});

@Injectable()
export class InterviewHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  // ---------- the company's defaults ----------

  /** The company's defaults in effect (the standard ones until changed). */
  async defaults(): Promise<InterviewDefaults> {
    const row = await this.prisma.interviewSettings.findUnique({ where: { id: 1 }, select: { noticeHours: true, bufferMinutes: true } });
    return row ? { noticeHours: row.noticeHours, bufferMinutes: row.bufferMinutes } : { ...INTERVIEW_DEFAULTS_STANDARD };
  }

  /** GET /interview-hours/settings. */
  async settings(): Promise<InterviewDefaultsView> {
    const row = await this.prisma.interviewSettings.findUnique({ where: { id: 1 }, include: { updatedBy: { select: { id: true, email: true } } } });
    const names = await userNames(this.prisma, [row?.updatedBy ?? null]);
    return {
      defaults: row ? { noticeHours: row.noticeHours, bufferMinutes: row.bufferMinutes } : { ...INTERVIEW_DEFAULTS_STANDARD },
      standard: { ...INTERVIEW_DEFAULTS_STANDARD },
      updatedAt: row?.updatedById ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ? (names.get(row.updatedBy.id) ?? null) : null,
    };
  }

  /** PUT /interview-hours/settings: HR, the CEO or a Super Admin. Audited with what changed. */
  async saveSettings(dto: InterviewDefaultsDto, user: SessionUser): Promise<InterviewDefaultsView> {
    const problems = interviewDefaultsProblems(dto);
    if (problems.length) throw new BadRequestException(problems);
    const before = await this.defaults();
    const diff: Record<string, { from: number; to: number }> = {};
    if (before.noticeHours !== dto.noticeHours) diff.noticeHours = { from: before.noticeHours, to: dto.noticeHours };
    if (before.bufferMinutes !== dto.bufferMinutes) diff.bufferMinutes = { from: before.bufferMinutes, to: dto.bufferMinutes };
    if (!Object.keys(diff).length) return this.settings();
    const data = { noticeHours: dto.noticeHours, bufferMinutes: dto.bufferMinutes, updatedById: user.id, updatedAt: new Date() };
    await this.prisma.interviewSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await this.audit.record({ userId: user.id, action: 'update', entityType: INTERVIEW_SETTINGS_ENTITY, entityId: null, diff });
    return this.settings();
  }

  // ---------- someone's hours ----------

  /** The person's hours view (their hours, or none), with the company's defaults. */
  private async view(employee: { id: string; fullNameEn: string }): Promise<InterviewHoursView> {
    const [row, defaults] = await Promise.all([
      this.prisma.interviewHours.findUnique({ where: { employeeId: employee.id }, include: { updatedBy: { select: { id: true, email: true } } } }),
      this.defaults(),
    ]);
    const names = await userNames(this.prisma, [row?.updatedBy ?? null]);
    return {
      employeeId: employee.id,
      name: employee.fullNameEn,
      hours: row ? hoursOfRow(row) : null,
      defaults,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ? (names.get(row.updatedBy.id) ?? null) : null,
    };
  }

  /** A current employee the caller may set the hours of: 404 for one they don't see (a C-level person, for HR). */
  private async someone(employeeId: string, user: SessionUser): Promise<{ id: string; fullNameEn: string }> {
    if (!user.roles.some((r) => (SETS_ANYONES as readonly string[]).includes(r))) throw new ForbiddenException('Only HR, the CEO and a Super Admin set someone else’s interview hours.');
    const hidden = await this.confidential.hiddenFrom(user);
    if (hidden.includes(employeeId)) throw new NotFoundException(NOT_FOUND);
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, ...CURRENT(todayInCairo()) }, select: { id: true, fullNameEn: true } });
    if (!e) throw new NotFoundException(NOT_FOUND);
    return e;
  }

  /** The caller's own employee profile (a current one): 404 in words without one. */
  private async self(user: SessionUser): Promise<{ id: string; fullNameEn: string }> {
    const id = await this.confidential.selfId(user);
    const e = id ? await this.prisma.employee.findFirst({ where: { id, ...CURRENT(todayInCairo()) }, select: { id: true, fullNameEn: true } }) : null;
    if (!e) throw new NotFoundException(NO_PROFILE);
    return e;
  }

  /** GET /interview-hours/people/:employeeId. */
  async ofPerson(employeeId: string, user: SessionUser): Promise<InterviewHoursView> {
    return this.view(await this.someone(employeeId, user));
  }

  /** PUT /interview-hours/people/:employeeId. */
  async saveForPerson(employeeId: string, dto: InterviewHoursDto, user: SessionUser): Promise<InterviewHoursView> {
    const e = await this.someone(employeeId, user);
    await this.save(e, dto, user);
    return this.view(e);
  }

  /** GET /me/interview-hours: one's own, with their interviews to come and whether the dashboard asks for hours. */
  async mine(user: SessionUser, now = new Date()): Promise<MyInterviewHoursView> {
    const e = await this.self(user);
    const [view, upcoming, needsHours] = await Promise.all([this.view(e), this.upcomingOf(e.id, now), this.needsHours(e.id, now)]);
    return { ...view, upcoming, needsHours };
  }

  /** PUT /me/interview-hours. */
  async saveMine(dto: InterviewHoursDto, user: SessionUser, now = new Date()): Promise<MyInterviewHoursView> {
    const e = await this.self(user);
    await this.save(e, dto, user);
    return this.mine(user, now);
  }

  /** GET /me/interview-hours/reminder: the dashboard's banner (nothing for an account without an employee profile). */
  async reminder(user: SessionUser, now = new Date()): Promise<InterviewHoursReminder> {
    const id = await this.confidential.selfId(user);
    return { show: id ? await this.needsHours(id, now) : false };
  }

  /**
   * Saves someone's hours: checked (the company's defaults the floor), tidied (the ranges in order, the one-off changes
   * from today on), or cleared when there are no ranges and no changes. Audited with what changed, the week in words.
   */
  private async save(e: { id: string; fullNameEn: string }, dto: InterviewHoursDto, user: SessionUser): Promise<void> {
    const today = todayInCairo();
    const defaults = await this.defaults();
    const input: InterviewHours = {
      windows: windowsOf(dto.windows),
      changes: changesOf(dto.changes),
      effectiveFrom: dto.effectiveFrom,
      noticeHours: dto.noticeHours ?? null,
      bufferMinutes: dto.bufferMinutes ?? null,
    };
    const problems = interviewHoursProblems(input, defaults, today);
    if (problems.length) throw new BadRequestException(problems);
    const next = tidyHours(input, today);
    const row = await this.prisma.interviewHours.findUnique({ where: { employeeId: e.id } });
    const before = row ? hoursOfRow(row) : null;
    const clear = !next.windows.length && !next.changes.length;
    const week = (h: InterviewHours | null) => hoursSummary(h) ?? 'None';
    const diff: Record<string, unknown> = { employee: e.fullNameEn };
    if (week(before) !== week(clear ? null : next)) diff.windows = { from: week(before), to: week(clear ? null : next) };
    const changesText = (h: InterviewHours | null) => (h?.changes.length ? h.changes.map((c) => `${c.date} ${c.kind === 'off' ? 'off' : `${c.from}–${c.to}`}`).join(', ') : 'None');
    if (changesText(before) !== changesText(clear ? null : next)) diff.changes = { from: changesText(before), to: changesText(clear ? null : next) };
    if (!clear) {
      if (before?.effectiveFrom !== next.effectiveFrom) diff.effectiveFrom = { from: before?.effectiveFrom ?? null, to: next.effectiveFrom };
      if ((before?.noticeHours ?? null) !== next.noticeHours) diff.noticeHours = { from: before?.noticeHours ?? null, to: next.noticeHours };
      if ((before?.bufferMinutes ?? null) !== next.bufferMinutes) diff.bufferMinutes = { from: before?.bufferMinutes ?? null, to: next.bufferMinutes };
    }
    if (Object.keys(diff).length === 1) return;
    if (clear) {
      if (!row) return;
      await this.prisma.interviewHours.delete({ where: { employeeId: e.id } });
    } else {
      const data = {
        windows: next.windows as unknown as Prisma.InputJsonValue,
        changes: next.changes as unknown as Prisma.InputJsonValue,
        effectiveFrom: toDateOnly(next.effectiveFrom),
        noticeHours: next.noticeHours,
        bufferMinutes: next.bufferMinutes,
        updatedById: user.id,
      };
      await this.prisma.interviewHours.upsert({ where: { employeeId: e.id }, create: { employeeId: e.id, ...data }, update: data });
    }
    await this.audit.record({ userId: user.id, action: row ? 'update' : 'create', entityType: INTERVIEW_HOURS_ENTITY, entityId: e.id, diff });
  }

  // ---------- who interviews ----------

  /** Their interviews still to come, soonest first. */
  private async upcomingOf(employeeId: string, now: Date): Promise<MyUpcomingInterview[]> {
    const rows = await this.prisma.interview.findMany({
      where: { status: 'scheduled', startsAt: { gte: now }, interviewers: { some: { employeeId } } },
      select: { id: true, startsAt: true, minutes: true, kind: true, application: { select: { id: true, fullName: true, vacancy: { select: { title: true } } } } },
      orderBy: { startsAt: 'asc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      startsAt: r.startsAt.toISOString(),
      minutes: r.minutes,
      kind: r.kind as InterviewKind,
      applicationId: r.application.id,
      candidate: r.application.fullName,
      job: r.application.vacancy.title,
    }));
  }

  /** Whether the dashboard asks them for hours: none set, and a hiring manager of an open vacancy or on a panel to come. */
  private async needsHours(employeeId: string, now: Date): Promise<boolean> {
    const [hours, managing, panel] = await Promise.all([
      this.prisma.interviewHours.count({ where: { employeeId } }),
      this.prisma.vacancy.count({ where: { hiringManagerId: employeeId, status: 'open' } }),
      this.prisma.interview.count({ where: { status: 'scheduled', startsAt: { gte: now }, interviewers: { some: { employeeId } } } }),
    ]);
    return hours === 0 && (managing > 0 || panel > 0);
  }

  /**
   * GET /interview-hours: the company's defaults and the people who interview: the hiring managers of open (or held)
   * vacancies the caller sees, those on a panel to come, and everyone with hours; current employees only, never a C-level
   * person hidden from the caller. By name.
   */
  async interviewers(user: SessionUser, now = new Date()): Promise<InterviewersView> {
    const today = todayInCairo();
    const hidden = await this.confidential.hiddenFrom(user);
    const [managers, panels, withHours, settings] = await Promise.all([
      this.prisma.vacancy.findMany({ where: { AND: [vacancyWhere(user), { status: { in: ['open', 'on_hold'] }, hiringManagerId: { not: null } }] }, select: { hiringManagerId: true } }),
      this.prisma.interviewInterviewer.findMany({ where: { interview: { status: 'scheduled', startsAt: { gte: now } } }, select: { employeeId: true } }),
      this.prisma.interviewHours.findMany({ select: { employeeId: true, windows: true, changes: true, effectiveFrom: true, noticeHours: true, bufferMinutes: true, updatedAt: true } }),
      this.settings(),
    ]);
    const reasons = new Map<string, Set<InterviewerReason>>();
    const add = (id: string | null, why: InterviewerReason) => {
      if (!id || hidden.includes(id)) return;
      if (!reasons.has(id)) reasons.set(id, new Set());
      reasons.get(id)!.add(why);
    };
    for (const v of managers) add(v.hiringManagerId, 'hiring_manager');
    for (const p of panels) add(p.employeeId, 'panel');
    for (const h of withHours) add(h.employeeId, 'hours');
    const people = reasons.size
      ? await this.prisma.employee.findMany({ where: { id: { in: [...reasons.keys()] }, ...CURRENT(today) }, select: { id: true, fullNameEn: true }, orderBy: { fullNameEn: 'asc' } })
      : [];
    const hoursBy = new Map(withHours.map((h) => [h.employeeId, h]));
    const order: InterviewerReason[] = ['hiring_manager', 'panel', 'hours'];
    return {
      settings,
      people: people.map((p): InterviewerRow => {
        const h = hoursBy.get(p.id);
        return {
          employeeId: p.id,
          name: p.fullNameEn,
          reasons: order.filter((r) => reasons.get(p.id)!.has(r)),
          summary: h ? (hoursSummary(hoursOfRow(h)) ?? 'One-off hours only') : null,
          updatedAt: h?.updatedAt.toISOString() ?? null,
        };
      }),
    };
  }
}
