import { Injectable } from '@nestjs/common';
import { kpiAttendanceAchieved, kpiOpeningMonth, kpiScorerOf } from '@trendlix/shared';
import { toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { approverFor } from '../organisation/departments/leads.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { KpiAttendanceService, type KpiAttendanceRead } from './kpi-attendance.service.js';
import { attendanceInKpi } from './kpi-rescore.service.js';

// Opening a month's KPI scorecards (owner, 21 October 2026: "Last month's KPI, this pay": October's opens on 1
// November; the brief: "Scorecards, one per employee and month, created on the 1st for every employee with a published
// template for their job title. Not freelancers or unpaid interns; trainees yes"). For month M, on the 1st of M + 1 (or
// later, the ones still missing): everyone whose employment was in M and hadn't ended by that 1st (the latest one, a
// person rehired), under a job title whose template has a version in force then (the newest published whose opens_from
// has come), and who has no scorecard for M yet. Each keeps the version it opened with, where they worked, its scorer
// (packages/shared kpiScorerOf: the person in charge as leave's manager stage has it, approverFor; HR when nobody is;
// the CEO for a C-level person, a Super Admin for the CEO's own) and the month's attendance score for its Attendance
// metric (kpi-attendance.service.ts), refreshed again as it is scored, and whether that metric counts: Attendance in the
// KPI as it is (owner, 25 October 2026: "Fixed cut only": off from then; the attendance is still read, for when it is
// switched on again). A row for each metric's picks, and the step "Opened". Done in the caller's transaction (the
// scheduler's, holding its lock).

type Tx = Prisma.TransactionClient;

/** A scorecard just opened. */
export interface OpenedScorecard {
  id: string;
  employeeId: string;
  employeeCode: string;
  templateId: string;
  scorer: string;
}

/** The Attendance metric's columns from a month's attendance read. */
export function attendanceColumns(read: KpiAttendanceRead, points: number) {
  return {
    attendanceRatio: read.ratio,
    attendanceScore: read.score,
    attendanceAchieved: kpiAttendanceAchieved(points, read.score),
    attendanceSource: read.source,
  };
}

@Injectable()
export class KpiOpeningService {
  constructor(
    private readonly attendance: KpiAttendanceService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** Opens the month's (YYYY-MM) missing scorecards; answers those opened. */
  async openMonth(month: string, tx: Tx): Promise<OpenedScorecard[]> {
    const monthDay = toDateOnly(firstDay(month));
    const openDay = toDateOnly(firstDay(kpiOpeningMonth(month)));
    const employments = await tx.employment.findMany({
      where: {
        joinDate: { lte: toDateOnly(lastDay(month)) },
        OR: [{ endDate: null }, { endDate: { gte: openDay } }],
        jobTitleId: { not: null },
        // not freelancers or unpaid interns (packages/shared kpiEligibleType; the paid trainee went on 25 October 2026)
        employmentType: { notIn: ['freelance', 'intern'] },
        // a real one: a practice scorecard of the month never stands in its way (owner, 22 October 2026: "Practice scorecards")
        employee: { kpiScorecards: { none: { month: monthDay, practice: false } } },
      },
      orderBy: { joinDate: 'desc' },
      select: { id: true, employeeId: true, managerId: true, departmentId: true, jobTitleId: true, employee: { select: { employeeCode: true, workEmail: true } } },
    });
    const latest = new Map<string, (typeof employments)[number]>();
    for (const e of employments) if (!latest.has(e.employeeId)) latest.set(e.employeeId, e);
    if (!latest.size) return [];

    const templates = await tx.kpiTemplate.findMany({
      where: { jobTitleId: { in: [...new Set([...latest.values()].map((e) => e.jobTitleId!))] }, status: 'published', opensFrom: { lte: openDay } },
      orderBy: { version: 'desc' },
      select: { id: true, jobTitleId: true, attendancePoints: true, metrics: { select: { id: true } } },
    });
    const inForce = new Map<string, (typeof templates)[number]>();
    for (const t of templates) if (!inForce.has(t.jobTitleId)) inForce.set(t.jobTitleId, t);
    const people = [...latest.values()].filter((e) => inForce.has(e.jobTitleId!));
    if (!people.length) return [];

    const [confidential, ceoEmails, reads, counted] = await Promise.all([
      this.confidential.ids(tx),
      tx.user.findMany({ where: { isActive: true, roles: { some: { role: { key: 'ceo' } } } }, select: { employeeId: true } }),
      this.attendance.readMonth(month, people.map((e) => e.employeeId), tx),
      attendanceInKpi(tx),
    ]);
    // the CEO's own profile by their account's link (users.employee_id, 22 October 2026: never by email)
    const ceos = new Set(ceoEmails.flatMap((u) => (u.employeeId ? [u.employeeId] : [])));

    const opened: OpenedScorecard[] = [];
    for (const e of people) {
      const template = inForce.get(e.jobTitleId!)!;
      const isConfidential = confidential.has(e.employeeId);
      const approver = isConfidential ? null : await approverFor(tx, { employeeId: e.employeeId, managerId: e.managerId, departmentId: e.departmentId });
      const scorer = kpiScorerOf({ confidential: isConfidential, isCeo: ceos.has(e.employeeId), approverId: approver?.employeeId ?? null });
      const made = await tx.kpiScorecard.create({
        data: {
          employeeId: e.employeeId,
          employmentId: e.id,
          month: monthDay,
          templateId: template.id,
          departmentId: e.departmentId,
          status: 'self_rating',
          scorer,
          managerId: scorer === 'manager' ? approver!.employeeId : null,
          approverRole: scorer === 'manager' ? approver!.role : null,
          ...attendanceColumns(reads.get(e.employeeId) ?? { ratio: null, score: null, source: 'none' }, template.attendancePoints),
          attendanceCounted: counted,
          scores: { create: template.metrics.map((m) => ({ metricId: m.id })) },
          steps: { create: { kind: 'opened' } },
        },
        select: { id: true },
      });
      opened.push({ id: made.id, employeeId: e.employeeId, employeeCode: e.employee.employeeCode, templateId: template.id, scorer });
    }
    return opened;
  }

  /** The Attendance metric read again for a scorecard (while it is scored). */
  async attendanceOf(month: string, employeeId: string, points: number, db?: Tx) {
    const read = (await this.attendance.readMonth(month, [employeeId], db)).get(employeeId) ?? { ratio: null, score: null, source: 'none' as const };
    return attendanceColumns(read, points);
  }
}
