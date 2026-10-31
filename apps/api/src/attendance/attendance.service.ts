import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addFigures,
  ATTENDANCE_SUMMARY_MONTHS,
  attendanceDayView,
  attendanceFigures,
  attendancePeriod,
  attendanceSummary,
  averageHoursADay,
  confidentialPeople,
  flagsOnWfhDay,
  matchesAttendanceFilter,
  monthRange,
  NO_ATTENDANCE_FIGURES,
  odCoversMoment,
  PERMISSION_RULE_DEFAULTS,
  periodMonthCount,
  seesPunchPoints,
  type AttendanceDayView,
  type AttendanceFigures,
  type AttendanceFilter,
  type AttendancePlace,
  type AttendanceSummaryGroup,
  type AttendanceSummaryRow,
  type ExemptionPeriod,
  type PayrollStatus,
  type PersonMonthFigures,
  type ShiftWindowTimes,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService, type ConfidentialView } from '../employees/confidential.service.js';
import { employedIn, placeName, userNames } from '../payroll/adjustments/people.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { actsAs } from '../auth/roles.js';
import { approvedOds, dutyDaysOf } from '../official-duty/od-days.js';
import { approvedWfhDays } from '../wfh/wfh-days.js';
import { AttendanceDaysService, DAY_SELECT, shiftTimesOf, type DayRow } from './attendance-days.service.js';
import { CheckInSetupService } from './check-in-setup.service.js';
import { AttendanceCorrectionsService, type MonthCorrectable, type MonthCorrection } from './corrections.service.js';
import { correctionAskWindowOf, type CorrectionAskWindow } from './correction-window.js';
import { seesEveryonesAttendance, teamOf } from './attendance-scope.js';
import type { AttendanceListQueryDto, AttendanceSummaryQueryDto } from './attendance.dto.js';
import { attendanceSummaryFileName, attendanceWorkbook } from './attendance-workbook.js';
import { PUNCH_SELECT, punchView, type PunchView } from './punch-views.js';

// The Attendance section (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not active
// in the side menu"): the days kept from Zoho People's imports (attendance_days, filled when HR applies an import on a
// month's draft payroll run) read back. Daily Attendance: a month of everyone's days for HR, the CEO and Finance, by
// person with the month's figures (packages/shared attendance-days.ts), filtered by department or team, person and "only
// with …"; a person's month; a manager's or a lead's team (attendance-scope.ts teamOf), and everyone's own. Each says
// where its days came from (the imports, who read and applied them, when) and, for those who see payroll, the month's
// run. The Summary: a period's figures by department and team, with its workbook. A C-level person (owner, 19 October
// 2026: "make C level Employees details not visible to HR") is only the CEO's, the Super Admin's and their own: for
// everyone else one hidden note, their person 404. The figures: the day's permission is the system's approved requests
// when the month has any, else Zoho's column (within the month's allowance), as the import counted them; short hours are
// against the shift's hours a day. Each press of Check in and Check out under its day (owner, 20 October 2026: "simplify
// this, i want to view if it is remote or office, and location link"): its place for everyone who sees the day, and the
// spot where it was pressed only for HR, the CEO, the Super Admin and the employee themself, a C-level person's never
// HR's (packages/shared seesPunchPoints; punch-views.ts). The workbook keeps the places only.

const NO_PROFILE = 'You have no employee profile, so there is no attendance of yours to show.';
const NOT_FOUND = 'Employee not found.';

/** Who a row of attendance is. */
export interface AttendanceEmployeeView {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  jobTitle: string | null;
  /** Where they worked that month: a department, or "Department › Team". */
  department: string | null;
  departmentId: string | null;
  /** C-level: shown so to the CEO, the Super Admin and themself. */
  confidential: boolean;
}

/** A person's month: their days as kept, with the month's figures. */
export interface AttendancePersonMonth {
  employee: AttendanceEmployeeView;
  month: string;
  /** Their shift's hours to work a day that month; null without one. */
  hoursADay: number | null;
  figures: AttendanceFigures;
  averageHours: number | null;
  /** Where the month's permission hours come from: the system's approved requests, Zoho's column, or none. */
  permissionFrom: 'system' | 'zoho' | null;
  /** Whether they checked in on the system this month (a day of theirs is the system's): Zoho's days count only before. */
  checksIn: boolean;
  /** Each day, one a date from its source (AttendanceDayView.source), with the import it came from. */
  days: (AttendanceDayView & { importId: string | null })[];
  /**
   * The month's work from home days approved for them (owner, 21 October 2026: "think about how should we handle the
   * working from home in out erp"; packages/shared wfh.ts), in date order: shown "Working from home" on those days, which
   * are expected anywhere (their office day's flags left out).
   */
  wfhDays: string[];
  /**
   * The month's official duty days approved for them (owner, 23 October 2026: "Official duty (OD) requests"; packages/shared
   * official-duty.ts), in date order, each with its request (a link to it), a full day or its times: shown "Official
   * duty" on those days, attended for its hours, expected anywhere within it (their office day's flags left out).
   */
  odDays: OdDayView[];
  /**
   * Their periods exempt from check-in with a day in the month (owner, 25 October 2026: "trat them as if they achived
   * their full working hours"), in date order: their exempt days are full, said Exempt.
   */
  exemptions: ExemptionPeriod[];
  /**
   * Daily Attendance and the team view (owner, 20 October 2026: "location link"): every press of the month on the
   * system, in order, the spot only for those who see it (punch-views.ts). Left out elsewhere (the Summary).
   */
  punches?: PunchView[];
}

/** A day of approved official duty, as a person's month lists it. */
export interface OdDayView {
  date: string;
  requestId: string;
  fullDay: boolean;
  fromTime: string | null;
  toTime: string | null;
}

/** An import the days shown came from. */
export interface AttendanceSourceView {
  importId: string;
  runId: string;
  month: string;
  /** The run's status: shown to those who see payroll only (null for the others). */
  runStatus: PayrollStatus | null;
  createdAt: string;
  createdBy: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  files: string[];
}

/** The month's payroll run, for the way to import its attendance: those who see payroll only. */
export interface AttendanceRunRef {
  id: string;
  status: PayrollStatus;
}

/** GET /attendance: a month of attendance as the caller sees it. */
export interface AttendanceMonthView {
  month: string;
  /** Everyone (HR, the CEO, Finance) or the caller's team (a manager, a lead). */
  scope: 'everyone' | 'team';
  filter: { departmentId: string | null; employeeId: string | null; only: AttendanceFilter | null };
  people: AttendancePersonMonth[];
  /** The figures of those listed, together. */
  totals: AttendanceFigures;
  /** Those employed in the month (as filtered by department and person) with no attendance kept for it. */
  withoutDays: AttendanceEmployeeView[];
  /** C-level people with attendance this month hidden from the caller: one note. */
  hidden: { count: number; label: string } | null;
  sources: AttendanceSourceView[];
  run: AttendanceRunRef | null;
}

/** GET /attendance/employees/:id and GET /attendance/me: one person's month. */
export interface AttendancePersonView {
  month: string;
  person: AttendancePersonMonth;
  /** The caller's own month. */
  self: boolean;
  sources: AttendanceSourceView[];
  run: AttendanceRunRef | null;
  /**
   * Attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"):
   * the person's corrections of the month (any status), whether its days can be corrected now (not once its payroll is
   * approved or paid), and whether the caller corrects a day of theirs directly (HR, never their own).
   */
  corrections: MonthCorrection[];
  correctable: MonthCorrectable;
  canCorrect: boolean;
  /**
   * On their own month: the days they can still ask to correct today (owner, 31 October 2026: "locked after 2 working
   * days"; correction-window.ts), from `from` to today. Null on someone else's.
   */
  ask: CorrectionAskWindow | null;
  /**
   * Every press of Check in and Check out on the system of the month (owner, 19 October 2026: "Check-in through the
   * system …"), in order: the day each counts on, in or out, the server's moment, office, home, remote or unknown, the
   * flags, the location's and the network's names; and the spot (its point and accuracy) only for HR, the CEO, the Super
   * Admin and the person themself (owner, 20 October 2026: "Yes, keep the spot"; punch-views.ts). The day shows the first
   * check-in and the last check-out; these show every press.
   */
  punches: PunchView[];
}

/** GET /attendance/summary: a period by department and team. */
export interface AttendanceSummaryView {
  generatedAt: string;
  period: { from: string; to: string };
  /** The months of the period with attendance kept. */
  months: string[];
  groups: AttendanceSummaryGroup[];
  totals: AttendanceSummaryRow;
  /** C-level people left out for the caller (owner, 19 October 2026). */
  hidden: { count: number; label: string } | null;
}

/** The Summary with each person's month, for the workbook's By Person sheet. */
export type AttendanceSummaryReport = AttendanceSummaryView & { rows: (PersonMonthFigures & { employee: AttendanceEmployeeView })[] };


/** Who the caller sees: everyone, or these people (a team, themself). */
type Scope = { kind: 'everyone' } | { kind: 'some'; ids: string[] };

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly attendanceDays: AttendanceDaysService,
    private readonly corrections: AttendanceCorrectionsService,
    private readonly setup: CheckInSetupService,
  ) {}

  /**
   * Daily Attendance (HR, the CEO, Finance: everyone) or a manager's team (a manager or a lead: their team; anyone else
   * 403): a month's people with days kept, each with their figures and days, as filtered.
   */
  async month(query: AttendanceListQueryDto, user: SessionUser): Promise<AttendanceMonthView> {
    const month = query.month ?? todayInCairo().slice(0, 7);
    const [confidential, me] = await Promise.all([this.confidential.view(user), this.confidential.selfId(user)]);
    const everyone = seesEveryonesAttendance(user);
    let scope: Scope = { kind: 'everyone' };
    if (!everyone) {
      const team = me ? await teamOf(this.prisma, me) : [];
      const leads = me ? (await this.prisma.department.count({ where: { headId: me } })) > 0 : false;
      if (!team.length && !user.roles.includes('manager') && !leads) {
        throw new ForbiddenException("Only HR, Finance, the CEO and managers see others' attendance. Your own is on My Attendance.");
      }
      scope = { kind: 'some', ids: team };
    }
    const filter = { departmentId: query.departmentId ?? null, employeeId: query.employeeId ?? null, only: query.only ?? null };

    // the people of the month in scope: those with days, and those employed in it (for those without days)
    const [days, employed] = await Promise.all([
      this.prisma.attendanceDay.findMany({
        where: { date: monthDays(month), ...(scope.kind === 'some' && { employeeId: { in: scope.ids } }) },
        orderBy: { date: 'asc' },
        select: DAY_SELECT,
      }),
      this.prisma.employment.findMany({
        where: { ...employedIn(month), ...(scope.kind === 'some' && { employeeId: { in: scope.ids } }) },
        orderBy: { joinDate: 'desc' },
        select: { employeeId: true },
      }),
    ]);
    const ids = [...new Set([...days.map((d) => d.employeeId), ...employed.map((e) => e.employeeId)])];
    // the C-level people with days hidden from the caller: one note, where the filters would list them by their card
    // (the person and the place are the directory's), never by their figures
    let hidden = ids.filter((id) => confidential.hidden.has(id) && days.some((d) => d.employeeId === id));
    if (filter.employeeId) hidden = hidden.filter((id) => id === filter.employeeId);
    if (filter.departmentId && hidden.length) {
      const placed = await this.prisma.employment.findMany({
        where: { employeeId: { in: hidden }, ...employedIn(month), OR: [{ departmentId: filter.departmentId }, { department: { parentId: filter.departmentId } }] },
        select: { employeeId: true },
      });
      hidden = hidden.filter((id) => placed.some((p) => p.employeeId === id));
    }
    const shownIds = ids.filter((id) => !confidential.hidden.has(id));
    const months = await this.personMonths(month, shownIds, days.filter((d) => !confidential.hidden.has(d.employeeId)), confidential);

    const inPlace = (e: AttendanceEmployeeView) => !filter.departmentId || e.departmentId === filter.departmentId || this.teamIn(e, filter.departmentId, months.places);
    const chosen = (e: AttendanceEmployeeView) => (!filter.employeeId || e.id === filter.employeeId) && inPlace(e);
    const people = [...months.people.values()]
      .filter((p) => p.days.length > 0 && chosen(p.employee) && matchesAttendanceFilter(p.figures, filter.only))
      .sort(byName);
    const withoutDays = filter.only
      ? []
      : [...months.people.values()]
          .filter((p) => p.days.length === 0 && chosen(p.employee))
          .map((p) => p.employee)
          .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn));
    const totals = people.reduce((t, p) => addFigures(t, p.figures), { ...NO_ATTENDANCE_FIGURES });
    // each person's presses under their days, the spot only for those who see it (20 October 2026: "location link")
    const pressed = people.length
      ? await this.prisma.attendancePunch.findMany({ where: { employeeId: { in: people.map((p) => p.employee.id) }, date: monthDays(month) }, orderBy: { at: 'asc' }, select: { employeeId: true, ...PUNCH_SELECT } })
      : [];
    const locations = pressed.length ? await this.setup.officeLocations() : [];
    for (const p of people) {
      const sees = seesPunchPoints(user, { self: p.employee.id === me, confidential: confidential.all.has(p.employee.id) });
      p.punches = pressed
        .filter((x) => x.employeeId === p.employee.id)
        .map((x) => onOdDay(onWfhDay(punchView(x, sees, locations), p.wfhDays), p.odDays, months.shifts.get(p.employee.id) ?? null));
    }
    return {
      month,
      scope: everyone ? 'everyone' : 'team',
      filter,
      people,
      totals,
      withoutDays,
      hidden: hidden.length ? { count: hidden.length, label: `${confidentialPeople(hidden.length)} — hidden` } : null,
      sources: await this.sources(people.flatMap((p) => p.days.map((d) => d.importId)), user),
      run: everyone ? await this.runOf(month) : null,
    };
  }

  /**
   * One person's month: for HR, the CEO and Finance anyone's (a C-level person only for the CEO and the Super Admin),
   * for a manager or a lead their team's (not a C-level person's), for everyone their own; 404 otherwise.
   */
  async person(employeeId: string, monthAsked: string | null | undefined, user: SessionUser): Promise<AttendancePersonView> {
    const month = monthAsked ?? todayInCairo().slice(0, 7);
    const me = await this.confidential.selfId(user);
    const self = me === employeeId;
    if (!self) {
      if (await this.confidential.isHidden(user, employeeId)) throw new NotFoundException(NOT_FOUND);
      if (!seesEveryonesAttendance(user)) {
        const team = me ? await teamOf(this.prisma, me) : [];
        if (!team.includes(employeeId)) throw new NotFoundException(NOT_FOUND);
      }
    }
    if (!(await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new NotFoundException(NOT_FOUND);
    return this.personView(employeeId, month, self, user);
  }

  /** The caller's own month (My Attendance): 404 without an employee profile. */
  async mine(monthAsked: string | null | undefined, user: SessionUser): Promise<AttendancePersonView> {
    const me = await this.confidential.selfId(user);
    if (!me) throw new NotFoundException(NO_PROFILE);
    return withoutExemption(await this.personView(me, monthAsked ?? todayInCairo().slice(0, 7), true, user));
  }

  /** The Summary (HR, the CEO, Finance): a period's figures by department and team, without the C-level people hidden from the caller. */
  async summary(query: AttendanceSummaryQueryDto, user: SessionUser): Promise<AttendanceSummaryView> {
    const { rows: _rows, ...view } = await this.report(query, user);
    return view;
  }

  private async report(query: AttendanceSummaryQueryDto, user: SessionUser): Promise<AttendanceSummaryReport> {
    const period = attendancePeriod(query, todayInCairo());
    if (periodMonthCount(period) > ATTENDANCE_SUMMARY_MONTHS) {
      throw new BadRequestException(`Choose at most ${ATTENDANCE_SUMMARY_MONTHS} months at once.`);
    }
    const confidential = await this.confidential.view(user);
    const days = await this.prisma.attendanceDay.findMany({
      where: { date: { gte: toDateOnly(firstDay(period.from)), lte: toDateOnly(lastDay(period.to)) } },
      orderBy: { date: 'asc' },
      select: DAY_SELECT,
    });
    const hidden = new Set(days.filter((d) => confidential.hidden.has(d.employeeId)).map((d) => d.employeeId));
    const shown = days.filter((d) => !confidential.hidden.has(d.employeeId));
    const rows: AttendanceSummaryReport['rows'] = [];
    const withDays: string[] = [];
    for (const month of monthRange(period.from, period.to)) {
      const of = shown.filter((d) => fromDateOnly(d.date).startsWith(month));
      // those who check in on the system have days even in a month with none kept (its working days gone by: absent)
      const checkIn = (await this.attendanceDays.checkInPeople(month)).filter((id) => !confidential.hidden.has(id));
      const ids = [...new Set([...of.map((d) => d.employeeId), ...checkIn])];
      if (!ids.length) continue;
      const months = await this.personMonths(month, ids, of, confidential);
      if (![...months.people.values()].some((p) => p.days.length)) continue;
      withDays.push(month);
      for (const p of [...months.people.values()].sort(byName)) {
        if (!p.days.length) continue;
        rows.push({ employeeId: p.employee.id, month, place: months.places.get(p.employee.id) ?? null, figures: p.figures, employee: p.employee });
      }
    }
    const places = await this.prisma.department.findMany({ orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }], select: { id: true, nameEn: true, parentId: true } });
    const { groups, totals } = attendanceSummary(rows, places);
    return {
      generatedAt: new Date().toISOString(),
      period,
      months: withDays,
      groups,
      totals,
      hidden: hidden.size ? { count: hidden.size, label: `${confidentialPeople(hidden.size)} left out: only the CEO and the Super Admin see their attendance.` } : null,
      rows,
    };
  }

  /** The Summary as an Excel workbook (by department and team, by person, each day); the download is in the audit log. */
  async workbook(query: AttendanceSummaryQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const report = await this.report(query, user);
    const confidential = await this.confidential.view(user);
    const ids = [...new Set(report.rows.map((r) => r.employeeId))];
    const days = ids.length
      ? await this.prisma.attendanceDay.findMany({
          where: { employeeId: { in: ids }, date: { gte: toDateOnly(firstDay(report.period.from)), lte: toDateOnly(lastDay(report.period.to)) } },
          orderBy: [{ date: 'asc' }],
          select: DAY_SELECT,
        })
      : [];
    // each person's days as their month shows them
    const dayRows: { month: string; employee: AttendanceEmployeeView; day: AttendanceDayView }[] = [];
    for (const month of report.months) {
      const of = days.filter((d) => fromDateOnly(d.date).startsWith(month));
      const listed = [...new Set(report.rows.filter((r) => r.month === month).map((r) => r.employeeId))];
      const months = await this.personMonths(month, listed, of, confidential);
      for (const p of [...months.people.values()].sort(byName)) for (const day of p.days) dayRows.push({ month, employee: p.employee, day });
    }
    const data = await attendanceWorkbook(report, dayRows);
    await this.audit.record({
      userId: user.id,
      action: 'attendance_summary_file',
      entityType: 'attendance_summary',
      diff: { from: report.period.from, to: report.period.to, months: report.months, people: ids.length },
    });
    return { fileName: attendanceSummaryFileName(report.period), data };
  }

  // ---------- helpers ----------

  /** One person's month, with where its days came from and (for those who see payroll) the month's run. */
  private async personView(employeeId: string, month: string, self: boolean, user: SessionUser): Promise<AttendancePersonView> {
    const confidential = await this.confidential.view(user);
    const days = await this.prisma.attendanceDay.findMany({ where: { employeeId, date: monthDays(month) }, orderBy: { date: 'asc' }, select: DAY_SELECT });
    const months = await this.personMonths(month, [employeeId], days, confidential);
    let person = months.people.get(employeeId);
    if (!person) {
      // no employment that month: their card as they are now
      const e = await this.prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { id: true, employeeCode: true, fullNameEn: true } });
      person = {
        employee: { ...e, jobTitle: null, department: null, departmentId: null, confidential: confidential.all.has(employeeId) },
        month,
        hoursADay: null,
        figures: { ...NO_ATTENDANCE_FIGURES },
        averageHours: null,
        permissionFrom: null,
        checksIn: false,
        days: [],
        wfhDays: [],
        odDays: [],
        exemptions: [],
      };
    }
    const payroll = seesEveryonesAttendance(user);
    const [sources, run, corrections, correctable, ask, punches, locations] = await Promise.all([
      this.sources(person.days.map((d) => d.importId), user),
      payroll ? this.runOf(month) : null,
      this.corrections.ofMonth(employeeId, month),
      this.corrections.monthCorrectable(month),
      self ? correctionAskWindowOf(this.prisma, employeeId, todayInCairo()) : null,
      this.prisma.attendancePunch.findMany({ where: { employeeId, date: monthDays(month) }, orderBy: { at: 'asc' }, select: PUNCH_SELECT }),
      this.setup.officeLocations(),
    ]);
    // the spot for HR, the CEO, the Super Admin and themself; a C-level person's never HR's (20 October 2026)
    const sees = seesPunchPoints(user, { self, confidential: confidential.all.has(employeeId) });
    // HR corrects a day directly (never their own; a C-level person's only HR who sees them, as they see the page)
    const canCorrect = actsAs(user.roles, ['hr']) && !self;
    return {
      month,
      person,
      self,
      sources,
      run,
      corrections,
      correctable,
      canCorrect,
      ask,
      punches: punches.map((p) => onOdDay(onWfhDay(punchView(p, sees, locations), person.wfhDays), person.odDays, months.shifts.get(employeeId) ?? null)),
    };
  }

  /**
   * Each person's month (AttendanceDaysService): their employment in it (the latest: its place, job title, shift), their
   * days of every source, one a date (a correction, the system's check-ins, Zoho's import), with the days gone by since
   * their first check-in on the system, their permission (the system's requests when the month has any, else Zoho's
   * within the allowance), the figures. People with no employment in the month and no days are left out.
   */
  private async personMonths(month: string, ids: readonly string[], days: readonly DayRow[], confidential: ConfidentialView) {
    const people = new Map<string, AttendancePersonMonth>();
    const places = new Map<string, AttendancePlace | null>();
    // each person's shift that month, for their official duties' hours (23 October 2026)
    const shifts = new Map<string, ShiftWindowTimes | null>();
    if (!ids.length) return { people, places, shifts };
    const [employees, months, permissions, setup, wfh, ods, holidays] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: [...ids] } }, select: { id: true, employeeCode: true, fullNameEn: true } }),
      this.attendanceDays.monthOf(month, ids, days),
      this.prisma.permissionRequest.findMany({
        where: { employeeId: { in: [...ids] }, status: 'approved', date: monthDays(month) },
        select: { employeeId: true, date: true, hours: true },
      }),
      this.prisma.leaveSettings.findUnique({ where: { id: 1 }, select: { permissionHoursPerMonth: true } }),
      approvedWfhDays(this.prisma, ids, firstDay(month), lastDay(month)),
      approvedOds(this.prisma, ids, firstDay(month), lastDay(month)),
      this.prisma.holiday.findMany({ where: { date: monthDays(month) }, select: { date: true } }),
    ]);
    const holidaySet = new Set(holidays.map((h) => fromDateOnly(h.date)));
    const allowance = setup?.permissionHoursPerMonth.toNumber() ?? PERMISSION_RULE_DEFAULTS.hoursPerMonth;

    for (const e of employees) {
      const m = months.get(e.id);
      if (!m) continue;
      const job = m.employment;
      const hoursADay = m.hoursADay;
      // the month's permission (owner, 19 October 2026: "In the system, like leave"): the approved requests when there are any
      const requests = permissions.filter((p) => p.employeeId === e.id);
      const system = new Map<string, number>();
      for (const r of requests) system.set(fromDateOnly(r.date), (system.get(fromDateOnly(r.date)) ?? 0) + r.hours.toNumber());
      const fromSystem = requests.length > 0;
      // their work from home days (21 October 2026): expected anywhere, so without the office day's flags
      const wfhDays = wfh.get(e.id) ?? [];
      // their official duty days (23 October 2026): expected anywhere within it, so without the office day's flags
      const shift = job?.shift ? shiftTimesOf(job.shift) : null;
      shifts.set(e.id, shift);
      const odDays: OdDayView[] = [...dutyDaysOf(ods, e.id, shift, holidaySet, firstDay(month), lastDay(month)).entries()].map(([date, od]) => ({
        date,
        requestId: od.requestId,
        fullDay: od.fullDay,
        fromTime: od.fromTime,
        toTime: od.toTime,
      }));
      const onDuty = (date: string, at: string | null) => odDays.some((o) => o.date === date && (o.fullDay || (!!at && odCoversMoment(date, o, Date.parse(at), shift))));
      const dayViews = m.days.map((d) => ({
        // Zoho's column on its days (and on a day corrected over one of them, which carries it)
        ...attendanceDayView(
          {
            ...d,
            permissionHours: fromSystem ? (system.get(d.date) ?? 0) : d.source === 'zoho' || d.source === 'correction' ? d.permissionHours : 0,
            ...((wfhDays.includes(d.date) || onDuty(d.date, d.checkIn)) && { flags: flagsOnWfhDay(d.flags) }),
          },
          hoursADay,
        ),
        importId: d.importId,
      }));
      const systemHours = [...system.values()].reduce((a, b) => a + b, 0);
      const figures = attendanceFigures(dayViews, fromSystem ? { permissionHours: systemHours } : { permissionLimit: allowance });
      const place = job?.department ? { id: job.department.id, nameEn: job.department.nameEn, parent: job.department.parent } : null;
      places.set(e.id, place);
      people.set(e.id, {
        employee: {
          ...e,
          jobTitle: job?.jobTitle?.titleEn ?? null,
          department: placeName(job?.department ?? null),
          departmentId: job?.departmentId ?? null,
          confidential: confidential.all.has(e.id),
        },
        month,
        hoursADay,
        figures,
        averageHours: averageHoursADay(figures),
        permissionFrom: fromSystem ? 'system' : figures.permissionHours > 0 ? 'zoho' : null,
        checksIn: m.sources.some((x) => x === 'system' || x === 'device'),
        days: dayViews,
        wfhDays,
        odDays,
        exemptions: m.exemptions,
      });
    }
    return { people, places, shifts };
  }

  /** Whether someone works in a team of the department chosen (a department's filter takes its teams). */
  private teamIn(e: AttendanceEmployeeView, departmentId: string, places: ReadonlyMap<string, AttendancePlace | null>): boolean {
    return places.get(e.id)?.parent?.id === departmentId;
  }

  /** The imports these days came from: when read and applied, by whom, their files; the run's status for those who see payroll. */
  private async sources(importIds: readonly (string | null)[], user: SessionUser): Promise<AttendanceSourceView[]> {
    const ids = [...new Set(importIds.filter((id): id is string => !!id))];
    if (!ids.length) return [];
    const rows = await this.prisma.attendanceImport.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        runId: true,
        month: true,
        files: true,
        createdAt: true,
        appliedAt: true,
        run: { select: { status: true } },
        createdBy: { select: { id: true, email: true } },
        appliedBy: { select: { id: true, email: true } },
      },
    });
    const names = await userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.appliedBy]));
    const payroll = seesEveryonesAttendance(user);
    return rows.map((r) => ({
      importId: r.id,
      runId: r.runId,
      month: fromDateOnly(r.month).slice(0, 7),
      runStatus: payroll ? (r.run.status as PayrollStatus) : null,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy ? (names.get(r.createdBy.id)?.name ?? null) : null,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      appliedBy: r.appliedBy ? (names.get(r.appliedBy.id)?.name ?? null) : null,
      files: (r.files as unknown as { name: string }[]).map((f) => f.name),
    }));
  }

  /** The month's payroll run, if there is one. */
  private async runOf(month: string): Promise<AttendanceRunRef | null> {
    const run = await this.prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { id: true, status: true } });
    return run ? { id: run.id, status: run.status as PayrollStatus } : null;
  }
}

/**
 * A press within an official duty approved for them (23 October 2026: "Check in from anywhere"): a full day, or within a
 * part day's hours; expected anywhere, without the office day's flags (one approved after the press too).
 */
function onOdDay(p: PunchView, odDays: readonly OdDayView[], shift: ShiftWindowTimes | null): PunchView {
  const on = odDays.some((o) => o.date === p.date && (o.fullDay || odCoversMoment(p.date, o, Date.parse(p.at), shift)));
  return on ? { ...p, flags: flagsOnWfhDay(p.flags) } : p;
}

/** A press on a work from home day approved for them (21 October 2026): expected anywhere, without the office day's flags. */
const onWfhDay = (p: PunchView, wfhDays: readonly string[]): PunchView => (wfhDays.includes(p.date) ? { ...p, flags: flagsOnWfhDay(p.flags) } : p);

/** The days of a month, as a date filter. */
const monthDays = (month: string) => ({ gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) });

const byName = (a: AttendancePersonMonth, b: AttendancePersonMonth) => a.employee.fullNameEn.localeCompare(b.employee.fullNameEn);

/**
 * Their own month as the employee sees it (owner, 31 October 2026: "dont show for the employee that he is exempted from
 * checking in and out"): no periods of exemption, no exempt days counted, no day marked exempt (a compensatory day off,
 * read full the same way, keeps its mark: it is theirs, asked for). The days still count as full hours; HR sees it all on
 * the person's month.
 */
export function withoutExemption(view: AttendancePersonView): AttendancePersonView {
  const person = view.person;
  return {
    ...view,
    person: {
      ...person,
      exemptions: [],
      figures: { ...person.figures, exemptDays: 0 },
      days: person.days.map((d) => (d.exempt && !d.compensatory ? { ...d, exempt: false } : d)),
    },
  };
}
