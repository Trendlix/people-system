import { ForbiddenException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  APPLICATION_SOURCE_LABELS,
  APPLICATION_SOURCES,
  APPLICATION_STAGE_LABELS,
  GENERAL_CV_SOURCE_LABELS,
  GENERAL_CV_SOURCES,
  averageDays,
  cairoDay,
  funnelOf,
  furthestStage,
  percentOf,
  seesConfidential,
  sourceOf,
  zonedMoment,
  type ApplicationSource,
  type FunnelStage,
  type RecruitmentAnalytics,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo } from '../common/date-only.js';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CONFIDENTIAL_VACANCY, READS, vacancyWhere } from './recruitment-access.js';

// Recruitment Analytics (Phase 2, owner, 22 October 2026; the original plan's spec §12 Analytics): for a year (and a
// department, its teams with it), for HR, the CEO and a Super Admin. A C-level vacancy is left out for those who don't
// see C-level people (counted in `hidden`). Pure arithmetic in packages/shared recruitment-hiring.ts.
// - Now: open vacancies and the people still to hire on them; candidates in the running on them.
// - The year's applicants (applied in it): the funnel by the furthest stage each reached (their history), the sources.
// - The year's hires (an accepted job offer in it): by month, time to hire (applied → hired), time to fill (the
//   vacancy's publishing → hired), by department; the probation of those whose probation has ended (still employed
//   after it: passed).
// - Job offers made from applications in the year: accepted of those answered (accepted or declined).

const REPORT_ENTITY = 'recruitment_analytics';

@Injectable()
export class RecruitmentAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertReads(user: SessionUser): void {
    if (!user.roles.some((r) => READS.includes(r))) throw new ForbiddenException('Only HR, the CEO and a Super Admin see the recruitment analytics.');
  }

  async analytics(query: { year?: number; departmentId?: string }, user: SessionUser): Promise<RecruitmentAnalytics> {
    this.assertReads(user);
    const today = todayInCairo();
    const year = query.year ?? Number(today.slice(0, 4));
    const from = new Date(zonedMoment(`${year}-01-01`, '00:00'));
    const to = new Date(zonedMoment(`${year + 1}-01-01`, '00:00'));
    const department: Prisma.VacancyWhereInput = query.departmentId ? { OR: [{ departmentId: query.departmentId }, { department: { parentId: query.departmentId } }] } : {};
    const vacancies: Prisma.VacancyWhereInput = { AND: [vacancyWhere(user), department] };
    const hidden = seesConfidential(user) ? 0 : await this.prisma.vacancy.count({ where: { AND: [CONFIDENTIAL_VACANCY, department] } });

    // now
    const open = await this.prisma.vacancy.findMany({
      where: { AND: [vacancies, { status: { in: ['open', 'on_hold'] } }] },
      select: { id: true, headcount: true, applications: { where: { stage: 'hired' }, select: { id: true } } },
    });
    const activeCandidates = await this.prisma.jobApplication.count({
      where: { vacancyId: { in: open.map((v) => v.id) }, filteredOut: false, stage: { in: ['applied', 'shortlisted', 'interview', 'offer'] } },
    });

    // the year's applicants
    const applied = await this.prisma.jobApplication.findMany({
      where: { vacancy: vacancies, createdAt: { gte: from, lt: to } },
      select: { source: true, stage: true, steps: { select: { stage: true } } },
    });
    const furthest = applied.map((a) => furthestStage([a.stage, ...a.steps.map((s) => s.stage)]));
    const rank = (f: FunnelStage) => ['applied', 'shortlisted', 'interview', 'offer', 'hired'].indexOf(f);
    const sources = APPLICATION_SOURCES.map((source: ApplicationSource) => {
      const of = applied.map((a, i) => ({ source: sourceOf(a.source), f: furthest[i] })).filter((x) => x.source === source);
      return { source, applicants: of.length, shortlisted: of.filter((x) => rank(x.f) >= 1).length, hired: of.filter((x) => x.f === 'hired').length };
    }).filter((s) => s.applicants > 0);

    // the year's hires
    const hiredSteps = await this.prisma.jobApplicationStep.findMany({
      where: { event: 'hired', at: { gte: from, lt: to }, application: { vacancy: vacancies } },
      select: {
        at: true,
        application: {
          select: {
            id: true,
            createdAt: true,
            employeeId: true,
            vacancy: { select: { publishedAt: true, departmentId: true, department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
          },
        },
      },
      orderBy: { at: 'asc' },
    });
    // one hire an application (its latest "hired")
    const hires = [...new Map(hiredSteps.map((h) => [h.application.id, h])).values()];
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const hiresByMonth = months.map((month) => ({ month, hires: hires.filter((h) => cairoDay(h.at).slice(0, 7) === month).length }));
    const byDepartment = new Map<string, { id: string | null; name: string; pairs: [Date, Date][] }>();
    for (const h of hires) {
      const d = h.application.vacancy.department;
      const key = h.application.vacancy.departmentId ?? 'none';
      const name = d ? (d.parent ? `${d.parent.nameEn} · ${d.nameEn}` : d.nameEn) : 'No department';
      const entry = byDepartment.get(key) ?? { id: h.application.vacancy.departmentId, name, pairs: [] };
      entry.pairs.push([h.application.createdAt, h.at]);
      byDepartment.set(key, entry);
    }

    // job offers made from applications in the year
    const offers = await this.prisma.jobOffer.groupBy({
      by: ['status'],
      where: { applicationId: { not: null }, createdAt: { gte: from, lt: to }, application: { vacancy: vacancies } },
      _count: { _all: true },
    });
    const offerCount = (status: string) => offers.find((o) => o.status === status)?._count._all ?? 0;
    const made = offers.reduce((sum, o) => sum + o._count._all, 0);
    const accepted = offerCount('accepted');
    const declined = offerCount('declined');

    // probation: the year's hires whose probation has ended
    const employeeIds = hires.map((h) => h.application.employeeId).filter((id): id is string => !!id);
    const employments = employeeIds.length
      ? await this.prisma.employment.findMany({ where: { employeeId: { in: employeeIds } }, select: { employeeId: true, joinDate: true, probationEnd: true, endDate: true }, orderBy: { joinDate: 'desc' } })
      : [];
    let ended = 0;
    let passed = 0;
    for (const id of new Set(employeeIds)) {
      const e = employments.find((x) => x.employeeId === id);
      if (!e?.probationEnd) continue;
      const end = fromDateOnly(e.probationEnd);
      if (end >= today) continue;
      ended++;
      if (!e.endDate || fromDateOnly(e.endDate) > end) passed++;
    }

    // general CVs received in the year (22 October 2026): by source and month, and those moved to a vacancy
    const cvs = await this.prisma.generalCv.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { source: true, status: true, createdAt: true } });
    const generalCvs = {
      received: cvs.length,
      moved: cvs.filter((c) => c.status === 'moved').length,
      bySource: GENERAL_CV_SOURCES.map((source) => ({ source, count: cvs.filter((c) => c.source === source).length })).filter((x) => x.count > 0),
      byMonth: months.map((month) => ({ month, count: cvs.filter((c) => cairoDay(c.createdAt).slice(0, 7) === month).length })),
    };

    return {
      year,
      departmentId: query.departmentId ?? null,
      openVacancies: open.length,
      openPositions: open.reduce((sum, v) => sum + Math.max(0, v.headcount - v.applications.length), 0),
      activeCandidates,
      applicants: applied.length,
      hires: hires.length,
      timeToHireDays: averageDays(hires.map((h) => [h.application.createdAt, h.at] as const)),
      timeToFillDays: averageDays(hires.filter((h) => h.application.vacancy.publishedAt).map((h) => [h.application.vacancy.publishedAt!, h.at] as const)),
      offers: { made, accepted, declined, acceptanceRate: percentOf(accepted, accepted + declined) },
      probation: { ended, passed, rate: percentOf(passed, ended) },
      funnel: funnelOf(furthest),
      hiresByMonth,
      sources,
      departments: [...byDepartment.values()].map((d) => ({ id: d.id, name: d.name, hires: d.pairs.length, timeToHireDays: averageDays(d.pairs) })).sort((a, b) => b.hires - a.hires || a.name.localeCompare(b.name)),
      hidden,
      generalCvs,
    };
  }

  /** The analytics as an Excel workbook: the figures, the funnel, hires by month, sources and departments. Audited. */
  async workbook(query: { year?: number; departmentId?: string }, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const r = await this.analytics(query, user);
    const wb = new ExcelJS.Workbook();
    type Figure = { label: string; value: string | number | null };
    const figures: Figure[] = [
      { label: 'Year', value: r.year },
      { label: 'Open vacancies (now)', value: r.openVacancies },
      { label: 'Open positions (now)', value: r.openPositions },
      { label: 'Active candidates (now)', value: r.activeCandidates },
      { label: 'Applicants', value: r.applicants },
      { label: 'Hires', value: r.hires },
      { label: 'Time to hire, days', value: r.timeToHireDays },
      { label: 'Time to fill, days', value: r.timeToFillDays },
      { label: 'Job offers made', value: r.offers.made },
      { label: 'Job offers accepted', value: r.offers.accepted },
      { label: 'Job offers declined', value: r.offers.declined },
      { label: 'Offer acceptance %', value: r.offers.acceptanceRate },
      { label: 'Probations ended', value: r.probation.ended },
      { label: 'Probations passed', value: r.probation.passed },
      { label: 'Probation pass rate %', value: r.probation.rate },
    ];
    addSheet<Figure>(
      wb,
      'Summary',
      [
        { header: 'Figure', width: 30, value: (f) => f.label },
        { header: 'Value', width: 14, value: (f) => f.value },
      ],
      figures,
    );
    type Step = RecruitmentAnalytics['funnel'][number];
    const funnel: Column<Step>[] = [
      { header: 'Stage', width: 16, value: (f) => APPLICATION_STAGE_LABELS[f.stage] },
      { header: 'Reached', width: 10, numFmt: '0', value: (f) => f.reached },
      { header: 'Of the stage before %', width: 14, numFmt: '0.0', value: (f) => f.conversion },
    ];
    addSheet(wb, 'Funnel', funnel, r.funnel);
    addSheet<RecruitmentAnalytics['hiresByMonth'][number]>(
      wb,
      'Hires by Month',
      [
        { header: 'Month', width: 12, value: (m) => m.month },
        { header: 'Hires', width: 10, numFmt: '0', value: (m) => m.hires },
      ],
      r.hiresByMonth,
    );
    addSheet<RecruitmentAnalytics['sources'][number]>(
      wb,
      'Sources',
      [
        { header: 'Source', width: 18, value: (s) => APPLICATION_SOURCE_LABELS[s.source] },
        { header: 'Applicants', width: 12, numFmt: '0', value: (s) => s.applicants },
        { header: 'Shortlisted', width: 12, numFmt: '0', value: (s) => s.shortlisted },
        { header: 'Hired', width: 10, numFmt: '0', value: (s) => s.hired },
      ],
      r.sources,
    );
    addSheet<RecruitmentAnalytics['departments'][number]>(
      wb,
      'Departments',
      [
        { header: 'Department', width: 30, value: (d) => d.name },
        { header: 'Hires', width: 10, numFmt: '0', value: (d) => d.hires },
        { header: 'Time to hire, days', width: 16, numFmt: '0.0', value: (d) => d.timeToHireDays },
      ],
      r.departments,
    );
    addSheet<RecruitmentAnalytics['generalCvs']['bySource'][number]>(
      wb,
      'General CVs',
      [
        { header: 'Source', width: 18, value: (x) => GENERAL_CV_SOURCE_LABELS[x.source] },
        { header: 'CVs', width: 10, numFmt: '0', value: (x) => x.count },
      ],
      r.generalCvs.bySource,
    );
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.record({ userId: user.id, action: 'analytics_file', entityType: REPORT_ENTITY, diff: { year: r.year, departmentId: r.departmentId, hires: r.hires } });
    return { fileName: `Recruitment ${r.year}.xlsx`, data };
  }
}
