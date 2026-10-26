import { BadRequestException, Injectable } from '@nestjs/common';
import {
  annualAvailable,
  DEFAULT_WORKING_DAYS,
  periodDays,
  periodProblem,
  requestedLeavePeriod,
  underLabourLaw,
  leaveReport,
  type LeaveReport,
  type LeaveReportSource,
  type LeaveReportSourceLeave,
  type LeaveReportSourcePermission,
  type LeaveReportSourceWfh,
  type ReportDepartment,
  type ReportPerson,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LeaveBalancesService, type LeaveEmployment } from './leave-balances.service.js';
import type { LeaveReportQueryDto } from './leave-report.dto.js';
import { leaveReportFileName, leaveReportWorkbook } from './leave-report-workbook.js';

const ENTITY = 'leave_report';

const PLACE = { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } } satisfies Prisma.DepartmentDefaultArgs;
const PERSON = { select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true } } satisfies Prisma.EmployeeDefaultArgs;
const EMPLOYMENT = { select: { department: PLACE } } satisfies Prisma.EmploymentDefaultArgs;

const personOf = (e: { id: string; employeeCode: string; fullNameEn: string; fullNameAr: string }): ReportPerson => ({
  id: e.id,
  employeeCode: e.employeeCode,
  fullNameEn: e.fullNameEn,
  fullNameAr: e.fullNameAr,
});

const placeOf = (d: { id: string; nameEn: string; parent: { id: string; nameEn: string } | null } | null): ReportDepartment | null =>
  d && { id: d.id, nameEn: d.nameEn, parent: d.parent && { id: d.parent.id, nameEn: d.parent.nameEn } };

const LEAVE = {
  id: true,
  startDate: true,
  endDate: true,
  halfDay: true,
  days: true,
  reason: true,
  recordedByHr: true,
  importId: true,
  zohoLinkId: true,
  type: { select: { id: true, nameEn: true, sortOrder: true, calendarDays: true } },
  employee: PERSON,
  employment: { select: { department: PLACE, shift: { select: { workingDays: true } } } },
} satisfies Prisma.LeaveRequestSelect;

/** Where a leave came from: a file or Zoho People brought it in, HR recorded it, or the employee asked for it. */
const sourceOf = (l: { importId: string | null; zohoLinkId: string | null; recordedByHr: boolean }): LeaveReportSource =>
  l.importId !== null || l.zohoLinkId !== null ? 'imported' : l.recordedByHr ? 'recorded' : 'requested';

/** What the report reads for some people (those the caller sees, or the C-level people hidden from them). */
interface Sources {
  leaves: LeaveReportSourceLeave[];
  permissions: LeaveReportSourcePermission[];
  wfh: LeaveReportSourceWfh[];
}

// The Leave report (owner, 26 October 2026: "can i get a report for the monthly leaves with all types?"; asked, "Both"
// (a summary and a list), to count the permission hours, the work from home days and the annual balance left too, and "A
// month, or a range"; packages/shared leave-report.ts): for a period of months, this month in Cairo unless asked, the
// approved leave overlapping it, each leave's days inside the period counted as the leave counts its days
// (leaveDaysBetween), the approved permission hours and work from home days in it, and the annual balance left at its end
// (today when the period ends later), as the balances page shows it. HR and the CEO, who see everyone's leave on Leave
// Requests. Every workbook downloaded is in the audit log, with its period and whose leave it has, as the Contracts
// report's. The C-level people (owner, 19 October 2026: "make C level Employees details not visible to HR") only for the
// CEO and a Super Admin: left out for anyone else, the totals too, `confidentialExcluded` saying how many.
@Injectable()
export class LeaveReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly balances: LeaveBalancesService,
  ) {}

  async report(query: LeaveReportQueryDto, user: SessionUser): Promise<LeaveReport & { generatedAt: string; balanceAsOf: string; confidentialExcluded: number }> {
    const today = todayInCairo();
    const period = requestedLeavePeriod(query, today);
    const problem = periodProblem(period);
    if (problem) throw new BadRequestException(problem);
    const { start, end } = periodDays(period);
    const hidden = await this.confidential.hiddenFrom(user);
    // a C-level person is not one to choose for someone who doesn't see them: as an unknown one
    if (query.employeeId && hidden.includes(query.employeeId)) throw new BadRequestException('Choose the employee from the list.');
    const [department, employee] = await Promise.all([
      query.departmentId ? this.prisma.department.findUnique({ where: { id: query.departmentId }, ...PLACE }) : null,
      query.employeeId ? this.prisma.employee.findUnique({ where: { id: query.employeeId }, ...PERSON }) : null,
    ]);
    if (query.departmentId && !department) throw new BadRequestException('Choose the department or team from the list.');
    if (query.employeeId && !employee) throw new BadRequestException('Choose the employee from the list.');

    const place: Prisma.EmploymentWhereInput = query.departmentId ? { OR: [{ departmentId: query.departmentId }, { department: { parentId: query.departmentId } }] } : {};
    const scope = (people: Prisma.EmployeeWhereInput) => ({ employee: { AND: [people, query.employeeId ? { id: query.employeeId } : {}] }, employment: place });
    const shown = await this.sources(scope(hidden.length ? { id: { notIn: hidden } } : {}), start, end);
    // the C-level people the report would have, left out for the caller (counted by the period and the place only)
    const left = hidden.length ? await this.sources(scope({ id: { in: hidden } }), start, end) : null;

    const holidays = (await this.prisma.holiday.findMany({ where: { date: { gte: toDateOnly(start), lte: toDateOnly(end) } }, select: { date: true } })).map((h) => fromDateOnly(h.date));
    const balanceAsOf = end < today ? end : today;
    const annualLeft = await this.annualLeft([...new Set([...shown.leaves.map((l) => l.employee.id), ...shown.permissions.map((p) => p.employee.id), ...shown.wfh.map((w) => w.employee.id)])], balanceAsOf, today);
    const built = leaveReport({ period, ...shown, holidays, annualLeft });

    return {
      generatedAt: new Date().toISOString(),
      balanceAsOf,
      filters: { period, department: placeOf(department), employee: employee && personOf(employee) },
      ...built,
      confidentialExcluded: left ? new Set([...left.leaves, ...left.permissions, ...left.wfh].map((x) => x.employee.id)).size : 0,
    };
  }

  /** The report as an Excel workbook, named with its period; the download is in the audit log. Without the C-level people, as the report. */
  async workbook(query: LeaveReportQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const report = await this.report(query, user);
    const data = await leaveReportWorkbook(report);
    const f = report.filters;
    await this.audit.record({
      userId: user.id,
      action: 'leave_report_file',
      entityType: ENTITY,
      diff: {
        from: f.period.from,
        to: f.period.to,
        leaves: report.leaves.length,
        employees: report.people.map((p) => p.employee.employeeCode),
      },
    });
    return { fileName: leaveReportFileName(f.period), data };
  }

  /** The approved leave overlapping the days, and the approved permission and work from home days in them, of the people `scope` keeps. */
  private async sources(scope: { employee: Prisma.EmployeeWhereInput; employment: Prisma.EmploymentWhereInput }, start: string, end: string): Promise<Sources> {
    const [leaves, permissions, wfh] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { ...scope, status: 'approved', startDate: { lte: toDateOnly(end) }, endDate: { gte: toDateOnly(start) } },
        select: LEAVE,
      }),
      this.prisma.permissionRequest.findMany({
        where: { ...scope, status: 'approved', date: { gte: toDateOnly(start), lte: toDateOnly(end) } },
        select: { date: true, hours: true, employee: PERSON, employment: EMPLOYMENT },
      }),
      this.prisma.wfhRequest.findMany({
        where: { ...scope, status: 'approved', date: { gte: toDateOnly(start), lte: toDateOnly(end) } },
        select: { date: true, employee: PERSON, employment: EMPLOYMENT },
      }),
    ]);
    return {
      leaves: leaves.map((l) => ({
        id: l.id,
        employee: personOf(l.employee),
        department: placeOf(l.employment.department),
        typeId: l.type.id,
        typeName: l.type.nameEn,
        typeOrder: l.type.sortOrder,
        startDate: fromDateOnly(l.startDate),
        endDate: fromDateOnly(l.endDate),
        halfDay: l.halfDay,
        calendarDays: l.type.calendarDays,
        days: l.days.toNumber(),
        workingDays: l.employment.shift?.workingDays ?? DEFAULT_WORKING_DAYS,
        source: sourceOf(l),
        reason: l.reason,
      })),
      permissions: permissions.map((p) => ({ employee: personOf(p.employee), department: placeOf(p.employment.department), date: fromDateOnly(p.date), hours: p.hours.toNumber() })),
      wfh: wfh.map((w) => ({ employee: personOf(w.employee), department: placeOf(w.employment.department), date: fromDateOnly(w.date) })),
    };
  }

  /**
   * The annual balance left of each person, as the balances page shows their current (else latest) employment's year of
   * `asOf`: what is left of it, with the leave booked and being decided, when `asOf` is today; for a period that ended,
   * what was left at its end: the year's days less the leave started by then. Null for someone outside the labour law.
   */
  private async annualLeft(employeeIds: readonly string[], asOf: string, today: string): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (!employeeIds.length) return out;
    const all = await this.balances.employmentsOfPeople(employeeIds);
    // the current employment (no end), else the latest to end, as the balances page picks it
    const chosen = new Map<string, LeaveEmployment>();
    for (const e of all) {
      const held = chosen.get(e.employeeId);
      if (!held || (held.endDate !== null && (e.endDate === null || e.endDate > held.endDate))) chosen.set(e.employeeId, e);
    }
    const year = Number(asOf.slice(0, 4));
    const figures = await this.balances.yearFigures([...chosen.values()].map((employment) => ({ employment, year })), asOf);
    for (const [employeeId, employment] of chosen) {
      const f = figures.get(`${employment.id}:${year}`);
      if (!f || !underLabourLaw(employment.employmentType)) {
        out.set(employeeId, null);
        continue;
      }
      out.set(employeeId, annualAvailable(asOf === today ? f : { ...f, booked: 0, pending: 0 }));
    }
    return out;
  }
}
