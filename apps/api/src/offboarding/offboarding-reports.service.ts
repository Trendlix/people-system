import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  END_REASON_LABELS,
  LEAVER_KIND_LABELS,
  leaverKindOf,
  tenureMonths,
  tenureText,
  turnoverOf,
  type EndReason,
  type FormerEmployeeRow,
  type OffboardingStatus,
  type RehireEligibility,
  type RehireMatch,
  type TurnoverReport,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import { placeName } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FormerQueryDto, RehireCheckDto } from './offboarding.dto.js';

// Former Employees, the turnover and rehire eligibility's warning (owner, 22 October 2026: the full module: "Former
// Employees tab … rehire eligibility, turnover numbers"; packages/shared offboarding.ts). For HR, the CEO and a Super
// Admin (the controller's roles). A C-level person (owner, 19 October 2026) is counted in the turnover's figures but
// named only to the CEO and a Super Admin: on Former Employees HR sees their name and dates alone, in the leavers' list
// no name, and no warning names them.

const reasonLabel = (reason: string) => END_REASON_LABELS[reason as EndReason] ?? reason;

const EMPLOYMENT_SELECT = {
  id: true,
  employeeId: true,
  employmentType: true,
  joinDate: true,
  endDate: true,
  endReason: true,
  departmentId: true,
  department: { select: { id: true, nameEn: true, parentId: true, parent: { select: { nameEn: true } } } },
  jobTitle: { select: { titleEn: true } },
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  offboarding: { select: { id: true, status: true, rehire: true, rehireReason: true } },
} as const;

@Injectable()
export class OffboardingReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  /**
   * Everyone whose employment ended and who doesn't work here now (none current), by their last employment, the latest
   * end first: when and why they left, how long they stayed, where and as what, their case and rehire eligibility.
   * Filtered by the year they left, the reason, and the department (with its teams) they left from.
   */
  async former(q: FormerQueryDto, user: SessionUser): Promise<FormerEmployeeRow[]> {
    const view = await this.confidential.view(user);
    const rows = await this.prisma.employment.findMany({
      where: { endDate: { not: null }, employee: { employments: { none: { endDate: null } } } },
      orderBy: [{ endDate: 'desc' }],
      select: EMPLOYMENT_SELECT,
    });
    // each person's last employment
    const seen = new Set<string>();
    const latest = rows.filter((r) => (seen.has(r.employeeId) ? false : (seen.add(r.employeeId), true)));
    const departments = q.departmentId ? await this.withTeams(q.departmentId) : null;
    return latest
      .filter((r) => {
        const end = fromDateOnly(r.endDate)!;
        if (q.year && end.slice(0, 4) !== q.year) return false;
        if (q.reason && r.endReason !== q.reason) return false;
        if (departments && (!r.departmentId || !departments.has(r.departmentId))) return false;
        return true;
      })
      .map((r): FormerEmployeeRow => {
        const restricted = view.hidden.has(r.employeeId);
        const end = fromDateOnly(r.endDate)!;
        const join = fromDateOnly(r.joinDate);
        return {
          employee: r.employee,
          employmentId: r.id,
          joinDate: join,
          endDate: end,
          endReason: restricted ? null : r.endReason,
          leaverKind: restricted ? 'other' : leaverKindOf(r.endReason),
          tenureMonths: tenureMonths(join, end),
          department: restricted ? null : placeName(r.department),
          jobTitle: restricted ? null : (r.jobTitle?.titleEn ?? null),
          caseId: restricted ? null : (r.offboarding?.id ?? null),
          clearance: restricted ? null : ((r.offboarding?.status as OffboardingStatus | undefined) ?? null),
          rehire: restricted ? null : ((r.offboarding?.rehire as RehireEligibility | null | undefined) ?? null),
          restricted,
        };
      });
  }

  /** The turnover of a year (this year unless sent), with who left. */
  async turnover(year: number | undefined, user: SessionUser): Promise<TurnoverReport> {
    const today = todayInCairo();
    const y = year ?? Number(today.slice(0, 4));
    const view = await this.confidential.view(user);
    const rows = await this.prisma.employment.findMany({ select: EMPLOYMENT_SELECT });
    const employments = rows.map((r) => ({
      joinDate: fromDateOnly(r.joinDate),
      endDate: fromDateOnly(r.endDate),
      endReason: r.endReason,
      employmentType: r.employmentType,
      // by department: a team's people count in its department
      department: r.department ? (r.department.parent?.nameEn ?? r.department.nameEn) : null,
    }));
    const figures = turnoverOf(employments, y, today, reasonLabel);
    const first = `${y}-01-01`;
    const last = `${y}-12-31`;
    const leaversList = rows
      .filter((r) => r.employmentType !== 'freelance' && r.endDate)
      .map((r) => ({ r, end: fromDateOnly(r.endDate)! }))
      .filter(({ end }) => end >= first && end <= last && end <= today)
      .sort((a, b) => b.end.localeCompare(a.end))
      .map(({ r, end }) => {
        const hidden = view.hidden.has(r.employeeId);
        return {
          employee: hidden ? null : { id: r.employee.id, fullNameEn: r.employee.fullNameEn },
          endDate: end,
          endReason: hidden ? null : r.endReason,
          leaverKind: leaverKindOf(r.endReason),
          department: hidden ? null : r.department ? (r.department.parent?.nameEn ?? r.department.nameEn) : null,
          tenureMonths: tenureMonths(fromDateOnly(r.joinDate), end),
        };
      });
    const joined = rows.map((r) => Number(fromDateOnly(r.joinDate).slice(0, 4)));
    const from = joined.length ? Math.min(...joined) : y;
    const to = Number(today.slice(0, 4));
    const years: number[] = [];
    for (let n = Math.max(to, y); n >= Math.min(from, y); n--) years.push(n);
    return { ...figures, leaversList, years };
  }

  /** The turnover of a year as an Excel workbook: the months, by department, reason and tenure, and who left. */
  async turnoverWorkbook(year: number | undefined, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const report = await this.turnover(year, user);
    const wb = new ExcelJS.Workbook();
    type Month = TurnoverReport['months'][number];
    const months: Column<Month>[] = [
      { header: 'Month', width: 12, value: (m) => m.month + (m.partial ? ' (so far)' : '') },
      { header: 'Headcount at the start', width: 14, numFmt: '0', value: (m) => m.start },
      { header: 'Headcount at the end', width: 14, numFmt: '0', value: (m) => m.end },
      { header: 'Average headcount', width: 14, numFmt: '0.0', value: (m) => m.average },
      { header: 'Leavers', width: 10, numFmt: '0', value: (m) => m.leavers },
      { header: 'Voluntary', width: 10, numFmt: '0', value: (m) => m.voluntary },
      { header: 'Involuntary', width: 11, numFmt: '0', value: (m) => m.involuntary },
      { header: 'Other', width: 8, numFmt: '0', value: (m) => m.other },
      { header: 'Turnover %', width: 11, numFmt: '0.0', value: (m) => m.rate },
    ];
    const totals: Month = {
      month: `${report.year}`,
      start: report.months[0]?.start ?? 0,
      end: report.months.at(-1)?.end ?? 0,
      average: report.averageHeadcount,
      leavers: report.leavers,
      voluntary: report.voluntary,
      involuntary: report.involuntary,
      other: report.other,
      rate: report.rate,
      partial: report.months.some((m) => m.partial),
    };
    addSheet(wb, 'Months', months, [...report.months, totals]);
    type Count = TurnoverReport['byDepartment'][number];
    const counts = (label: string): Column<Count>[] => [
      { header: label, width: 30, value: (c) => c.label },
      { header: 'Leavers', width: 10, numFmt: '0', value: (c) => c.leavers },
      { header: 'Voluntary', width: 10, numFmt: '0', value: (c) => c.voluntary },
    ];
    addSheet(wb, 'By Department', counts('Department'), report.byDepartment);
    addSheet(wb, 'By Reason', counts('Reason'), report.byReason);
    addSheet(wb, 'By Tenure', counts('Tenure'), report.byTenure);
    type Leaver = TurnoverReport['leaversList'][number];
    const leavers: Column<Leaver>[] = [
      { header: 'Employee', width: 28, value: (l) => l.employee?.fullNameEn ?? 'C-level (hidden)' },
      { header: 'Last working day', width: 14, value: (l) => shownDate(l.endDate) },
      { header: 'Reason', width: 20, value: (l) => (l.endReason ? reasonLabel(l.endReason) : null) },
      { header: 'Kind', width: 12, value: (l) => LEAVER_KIND_LABELS[l.leaverKind] },
      { header: 'Department', width: 24, value: (l) => l.department },
      { header: 'Tenure', width: 18, value: (l) => tenureText(l.tenureMonths) },
    ];
    addSheet(wb, 'Leavers', leavers, report.leaversList);
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.record({ userId: user.id, action: 'turnover_file', entityType: 'turnover_report', diff: { year: report.year, leavers: report.leavers } });
    return { fileName: `Turnover ${report.year}.xlsx`, data };
  }

  /**
   * The former employees a job offer or a new employment may be for (the brief: "a warning when a job offer or a new
   * hire matches a former employee (the national ID or email), especially Not eligible"): the person themself, the one
   * with that national ID, or with that work or personal email, who has left and doesn't work here now; with their
   * latest case's rehire eligibility. Never one hidden from the caller.
   */
  async rehireCheck(q: RehireCheckDto, user: SessionUser): Promise<RehireMatch[]> {
    const ids = new Map<string, RehireMatch['matchedBy']>();
    if (q.employeeId) ids.set(q.employeeId, 'employee');
    if (q.nationalId) {
      const identity = await this.prisma.employeeIdentity.findUnique({ where: { nationalId: q.nationalId }, select: { employeeId: true } });
      if (identity && !ids.has(identity.employeeId)) ids.set(identity.employeeId, 'national_id');
    }
    if (q.email) {
      const email = q.email.trim();
      const people = await this.prisma.employee.findMany({
        where: { OR: [{ workEmail: { equals: email, mode: 'insensitive' } }, { personalEmail: { equals: email, mode: 'insensitive' } }] },
        select: { id: true },
      });
      for (const p of people) if (!ids.has(p.id)) ids.set(p.id, 'email');
    }
    if (!ids.size) return [];
    const hidden = new Set(await this.confidential.hiddenFrom(user));
    const people = await this.prisma.employee.findMany({
      where: { id: { in: [...ids.keys()] }, employments: { some: { endDate: { not: null } }, none: { endDate: null } } },
      select: {
        id: true,
        fullNameEn: true,
        employments: { where: { endDate: { not: null } }, orderBy: { endDate: 'desc' }, take: 1, select: { endDate: true, endReason: true, offboarding: { select: { rehire: true, rehireReason: true } } } },
      },
    });
    return people
      .filter((p) => !hidden.has(p.id))
      .map((p): RehireMatch => {
        const e = p.employments[0];
        return {
          employeeId: p.id,
          fullNameEn: p.fullNameEn,
          leftOn: fromDateOnly(e?.endDate ?? null),
          endReason: e?.endReason ?? null,
          eligibility: (e?.offboarding?.rehire as RehireEligibility | null | undefined) ?? null,
          reason: e?.offboarding?.rehireReason ?? null,
          matchedBy: ids.get(p.id)!,
        };
      });
  }

  /** A department's id with its teams'. */
  private async withTeams(departmentId: string): Promise<Set<string>> {
    const teams = await this.prisma.department.findMany({ where: { parentId: departmentId }, select: { id: true } });
    return new Set([departmentId, ...teams.map((t) => t.id)]);
  }
}
