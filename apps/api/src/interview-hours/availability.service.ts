import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  addDaysYmd,
  availabilityNotes,
  availabilityProblems,
  cairoDay,
  datesFromTo,
  effectiveRules,
  findSlots,
  INTERVIEW_LIMITS,
  isInterviewKind,
  panelNames,
  slotWarnings,
  zonedMoment,
  type AvailabilityPerson,
  type AvailabilityView,
  type BusyBlock,
  type HolidayDay,
  type InterviewKind,
  type PanelPerson,
  type TimeCheckView,
} from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { CalendarsService } from '../calendars/calendars.service.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { managesRecruitment, vacancyWhere } from '../recruitment/recruitment-access.js';
import type { AvailabilityDto, TimeCheckDto } from './interview-hours.dto.js';
import { hoursOfRow, InterviewHoursService } from './interview-hours.service.js';

// "Find a time" and the warnings of a time typed by hand (owner, 25 October 2026: "Hours + calendar"; "HR only";
// packages/shared interview-availability.ts findSlots and slotWarnings). For the interviewers HR chose, it reads:
// - their interview hours, and the company's notice and buffer (theirs when stricter);
// - their approved leave and official duty (unavailable), the ones waiting for a decision and a half day's leave (kept,
//   marked "maybe"), never a leave's type; for an in-person interview, their days working from home (approved, or waiting:
//   maybe);
// - the public holidays (payroll's);
// - their interviews already booked (the one being moved left out), the buffer added around each;
// - their calendars' busy times, live, 5 seconds at most (CalendarsService.busyTimes: Zoho, Google, Microsoft), busy or
//   free only; a calendar that couldn't be read leaves the times offered, marked.
// A C-level person's leave, duty and days from home, and an interview of a C-level vacancy, are only "isn't free" to
// those who don't see C-level people (owner, 19 October 2026: "make C level Employees details not visible to HR"); their
// waiting ones aren't shown at all. Reads only: nothing here is saved, so nothing is audited (the interview's save is).

const PENDING = ['with_manager', 'with_hr'];
const DAY_MS = 86_400_000;
const HHMM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The moment as HH:mm in Cairo, as the form takes it. */
const cairoHhmm = (moment: number) => HHMM.format(new Date(moment));

/** A time column (Prisma's TIME, read as 1970-01-01 in UTC) as HH:mm. */
const timeOf = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

/** What the panel's checks are worked out with. */
interface Panel {
  people: PanelPerson[];
  views: AvailabilityPerson[];
  holidays: HolidayDay[];
}

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger('Availability');

  constructor(
    private readonly prisma: PrismaService,
    private readonly confidential: ConfidentialService,
    private readonly calendars: CalendarsService,
    private readonly hours: InterviewHoursService,
  ) {}

  private assertBooks(user: SessionUser): void {
    if (!managesRecruitment(user)) throw new ForbiddenException('Only HR (or a Super Admin) finds times and books interviews.');
  }

  /**
   * Everything that takes the panel's time away from `fromDate` to `toDate` (Cairo dates), for an interview held `kind`;
   * `excludeId`: the interview being moved. 400 in words for an interviewer who isn't a current employee.
   */
  private async panel(ids: readonly string[], fromDate: string, toDate: string, kind: InterviewKind, excludeId: string | null, user: SessionUser): Promise<Panel> {
    const today = todayInCairo();
    const unique = [...new Set(ids)];
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: unique }, employments: { some: { OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }] } } },
      select: { id: true, fullNameEn: true, workEmail: true, account: { select: { id: true, isActive: true } }, interviewHours: true },
    });
    if (employees.length !== unique.length) throw new BadRequestException(['Each interviewer must be a current employee: choose them from the list.']);
    const byId = new Map(employees.map((e) => [e.id, e]));
    const ordered = unique.map((id) => byId.get(id)!);
    const hidden = new Set(await this.confidential.hiddenFrom(user));
    const defaults = await this.hours.defaults();

    const start = zonedMoment(fromDate, '00:00');
    const end = zonedMoment(addDaysYmd(toDate, 1), '00:00');
    const from = toDateOnly(fromDate);
    const to = toDateOnly(toDate);
    const [leave, duty, wfh, holidays, booked, busy] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: unique }, status: { in: ['approved', ...PENDING] }, startDate: { lte: to }, endDate: { gte: from } },
        select: { employeeId: true, startDate: true, endDate: true, halfDay: true, status: true },
      }),
      this.prisma.odRequest.findMany({
        where: { employeeId: { in: unique }, status: { in: ['approved', ...PENDING] }, startDate: { lte: to }, endDate: { gte: from } },
        select: { employeeId: true, startDate: true, endDate: true, fullDay: true, fromTime: true, toTime: true, status: true },
      }),
      kind === 'in_person'
        ? this.prisma.wfhRequest.findMany({ where: { employeeId: { in: unique }, status: { in: ['approved', ...PENDING] }, date: { gte: from, lte: to } }, select: { employeeId: true, date: true, status: true } })
        : Promise.resolve([]),
      this.prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true, nameEn: true } }),
      this.prisma.interviewInterviewer.findMany({
        where: {
          employeeId: { in: unique },
          interview: { status: 'scheduled', ...(excludeId && { id: { not: excludeId } }), startsAt: { gte: new Date(start - DAY_MS), lt: new Date(end + DAY_MS) } },
        },
        select: { employeeId: true, interview: { select: { startsAt: true, minutes: true, application: { select: { vacancy: { select: { id: true } } } } } } },
      }),
      this.calendars.busyTimes(
        ordered.map((e) => ({ employeeId: e.id, userId: e.account?.isActive ? e.account.id : null, workEmail: e.workEmail })),
        new Date(start),
        new Date(end),
      ),
    ]);
    // the interviews of a C-level vacancy, for those who don't see them: "isn't free", nothing more
    const unseen = booked.length
      ? new Set(
          (await this.prisma.vacancy.findMany({ where: { id: { in: [...new Set(booked.map((b) => b.interview.application.vacancy.id))] }, NOT: vacancyWhere(user) }, select: { id: true } })).map(
            (v) => v.id,
          ),
        )
      : new Set<string>();

    const blocks = new Map<string, BusyBlock[]>(unique.map((id) => [id, []]));
    const push = (id: string, b: BusyBlock) => blocks.get(id)!.push(b);
    /** Whole Cairo days from `a` to `b` (dates), clipped to the range, as one block. */
    const days = (a: Date, b: Date) => {
      const first = fromDateOnly(a) < fromDate ? fromDate : fromDateOnly(a);
      const last = fromDateOnly(b) > toDate ? toDate : fromDateOnly(b);
      return { start: zonedMoment(first, '00:00'), end: zonedMoment(addDaysYmd(last, 1), '00:00') };
    };
    for (const l of leave) {
      const approved = l.status === 'approved';
      const whole = approved && !l.halfDay;
      if (hidden.has(l.employeeId)) {
        if (whole) push(l.employeeId, { ...days(l.startDate, l.endDate), kind: 'hidden' });
        continue;
      }
      push(l.employeeId, { ...days(l.startDate, l.endDate), kind: whole ? 'away' : 'away_maybe' });
    }
    for (const d of duty) {
      const approved = d.status === 'approved';
      if (hidden.has(d.employeeId) && !approved) continue;
      const kind = hidden.has(d.employeeId) ? 'hidden' : approved ? 'away' : 'away_maybe';
      if (d.fullDay || !d.fromTime || !d.toTime) {
        push(d.employeeId, { ...days(d.startDate, d.endDate), kind });
        continue;
      }
      // part of each day only: those hours of every day it spans
      const span = days(d.startDate, d.endDate);
      for (const date of datesFromTo(cairoDay(span.start), cairoDay(span.end - 1))) {
        push(d.employeeId, { start: zonedMoment(date, timeOf(d.fromTime)), end: zonedMoment(date, timeOf(d.toTime)), kind });
      }
    }
    for (const w of wfh) {
      const approved = w.status === 'approved';
      if (hidden.has(w.employeeId) && !approved) continue;
      push(w.employeeId, { ...days(w.date, w.date), kind: hidden.has(w.employeeId) ? 'hidden' : approved ? 'wfh' : 'wfh_maybe' });
    }
    for (const b of booked) {
      const s = b.interview.startsAt.getTime();
      push(b.employeeId, { start: s, end: s + b.interview.minutes * 60_000, kind: unseen.has(b.interview.application.vacancy.id) ? 'hidden' : 'interview', at: s });
    }
    for (const e of ordered) {
      for (const c of busy.get(e.id)?.blocks ?? []) push(e.id, { start: c.start, end: c.end, kind: c.tentative ? 'calendar_maybe' : 'calendar' });
    }

    const people: PanelPerson[] = ordered.map((e) => {
      const hours = e.interviewHours ? hoursOfRow(e.interviewHours) : null;
      return { id: e.id, name: e.fullNameEn, hours, rules: effectiveRules(hours, defaults), blocks: blocks.get(e.id)!, calendar: busy.get(e.id)?.calendar ?? 'none' };
    });
    const views: AvailabilityPerson[] = ordered.map((e) => {
      const b = busy.get(e.id);
      return { employeeId: e.id, name: e.fullNameEn, hasHours: !!e.interviewHours, calendar: b?.calendar ?? 'none', sources: b?.sources ?? [], reconnect: b?.reconnect ?? false };
    });
    return { people, views, holidays: holidays.map((h) => ({ date: fromDateOnly(h.date), name: h.nameEn })) };
  }

  /** POST /recruitment/availability: the times every interviewer chosen is free, grouped by day. HR's and a Super Admin's. */
  async find(dto: AvailabilityDto, user: SessionUser, now = new Date()): Promise<AvailabilityView> {
    this.assertBooks(user);
    const today = todayInCairo();
    const problems = availabilityProblems(dto, today);
    if (problems.length) throw new BadRequestException(problems);
    const from = dto.from < today ? today : dto.from;
    const p = await this.panel(dto.interviewerIds, from, dto.to, dto.kind, dto.interviewId ?? null, user);
    const found = findSlots(p.people, { from, to: dto.to, minutes: dto.minutes, now: now.getTime(), holidays: p.holidays });
    const names = panelNames(p.views.map((v) => ({ id: v.employeeId, name: v.name })));
    const reconnect = p.views.filter((v) => v.reconnect).map((v) => `${names.get(v.employeeId)}’s Google calendar doesn’t share busy times yet: they reconnect it on Your Meetings to share them.`);
    return {
      from,
      to: dto.to,
      minutes: dto.minutes,
      kind: dto.kind,
      people: p.views,
      days: found.days.map((d) => ({
        date: d.date,
        holiday: d.holiday,
        slots: d.slots.map((s) => ({ start: new Date(s.start).toISOString(), time: cairoHhmm(s.start), people: s.people.map((x) => ({ employeeId: x.id, status: x.status })), marked: s.marked })),
      })),
      truncated: found.truncated,
      notes: [...availabilityNotes(p.views, found.noHours, found.truncated), ...reconnect],
    };
  }

  /** POST /recruitment/availability/check: the warnings of a time typed by hand (never a refusal). */
  async check(dto: TimeCheckDto, user: SessionUser, now = new Date()): Promise<TimeCheckView> {
    this.assertBooks(user);
    const startsAt = zonedMoment(dto.date, dto.time);
    if (!Number.isFinite(startsAt)) throw new BadRequestException(['Choose the day and the time of the interview.']);
    if (!dto.interviewerIds.length) throw new BadRequestException(['Choose who interviews them first.']);
    const p = await this.panel(dto.interviewerIds, cairoDay(startsAt), cairoDay(startsAt + dto.minutes * 60_000), dto.kind, dto.interviewId ?? null, user);
    return { warnings: slotWarnings(p.people, startsAt, dto.minutes, { now: now.getTime(), holidays: p.holidays }), people: p.views };
  }

  /**
   * The warnings of an interview's time as it is saved (scheduled or moved; `excludeId` the one moved), for the
   * interviews service: the same as check, never failing the save (a failure says so in one warning).
   */
  async warningsFor(input: { interviewerIds: readonly string[]; startsAt: Date; minutes: number; kind: string; excludeId?: string | null }, user: SessionUser, now = new Date()): Promise<string[]> {
    if (!input.interviewerIds.length || input.interviewerIds.length > INTERVIEW_LIMITS.interviewers || !isInterviewKind(input.kind)) return [];
    try {
      const s = input.startsAt.getTime();
      const p = await this.panel(input.interviewerIds, cairoDay(s), cairoDay(s + input.minutes * 60_000), input.kind, input.excludeId ?? null, user);
      return slotWarnings(p.people, s, input.minutes, { now: now.getTime(), holidays: p.holidays });
    } catch (err) {
      this.logger.warn(`The interviewers' availability couldn't be checked: ${(err as Error).name}.`);
      return ['The interviewers’ availability couldn’t be checked.'];
    }
  }
}
