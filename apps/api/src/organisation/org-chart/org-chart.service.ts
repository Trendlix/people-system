import { Injectable } from '@nestjs/common';
import type { SessionUser } from '../../auth/session-user.js';
import { seesEveryone } from '../../employees/access.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// The org chart (owner's request, 15 October 2026: "export the company org chart from what is made in this page", the
// Departments & Job Titles page): the company, its departments in the order an Admin set, each department's teams in
// theirs, and the job titles of each department and team with how many people hold them now. One read instead of the
// page asking for departments, job titles and employees separately.
//
// Who sees what: the structure and the numbers, everyone signed in, as the Organization pages (GET /departments and GET
// /job-titles are open to all); the people's names, only those who see every employee (HR, the CEO and Finance: see
// employees/access.ts), so a manager or an employee never learns from the chart who works where. The person in charge
// of each department and team (owner, 19 October 2026: "i want to add department lead person, the person in charge"),
// for everyone: the Departments page (GET /departments) names them to everyone signed in too.

const COMPANY_ID = 1; // one company per installation (see CompanyService)
const ORDER = [{ sortOrder: 'asc' }, { nameEn: 'asc' }] as const;
const PERSON = { select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true } } as const;

export interface OrgChartPerson {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
}

export interface OrgChartJobTitle {
  id: string;
  titleEn: string;
  titleAr: string | null;
  /** The current employments (no end date) with this job title; 0 when it is vacant. */
  headcount: number;
  /** Who they are, by English name: only for callers who see every employee (`showsPeople`). */
  people?: OrgChartPerson[];
}

export interface OrgChartTeam {
  id: string;
  nameEn: string;
  nameAr: string | null;
  /** The person in charge: a department's Head of department, a team's Team lead (packages/shared leadTitle); or null. */
  head: OrgChartPerson | null;
  /** Its own job titles, the most senior first (see byGrade). */
  jobTitles: OrgChartJobTitle[];
}

export interface OrgChartDepartment extends OrgChartTeam {
  /** Its teams, in the order an Admin set. */
  teams: OrgChartTeam[];
}

export interface OrgChart {
  company: { nameEn: string; nameAr: string | null; hasLogo: boolean; logoVersion: number | null };
  /** Whether the job titles list their people: HR, the CEO and Finance. */
  showsPeople: boolean;
  departments: OrgChartDepartment[];
}

type TitleRow = { id: string; departmentId: string; titleEn: string; titleAr: string | null; minGrade: { rank: number } | null; maxGrade: { rank: number } | null };

/**
 * Within a department or team, the most senior job title first: by the highest grade it takes (or its lowest, when its
 * range has no top), then by title. A title open to any grade comes last. An org chart reads from the top down, so Head of
 * Marketing comes before Senior Content Creator; the Departments & Job Titles page lists them by title.
 */
function byGrade(a: TitleRow, b: TitleRow): number {
  const rank = (t: TitleRow) => t.maxGrade?.rank ?? t.minGrade?.rank ?? 0;
  return rank(b) - rank(a) || a.titleEn.localeCompare(b.titleEn, 'en');
}

@Injectable()
export class OrgChartService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: SessionUser): Promise<OrgChart> {
    const showsPeople = seesEveryone(user);
    const current = { endDate: null, jobTitleId: { not: null } } as const; // an employment without an end date is current
    const [company, departments, titles, counts, holders] = await Promise.all([
      // the logo's bytes are never loaded: it has an update time exactly when there is one (see CompanyService.setLogo)
      this.prisma.company.findUnique({ where: { id: COMPANY_ID }, select: { nameEn: true, nameAr: true, logoUpdatedAt: true } }),
      this.prisma.department.findMany({ orderBy: [...ORDER], select: { id: true, nameEn: true, nameAr: true, parentId: true, head: PERSON } }),
      this.prisma.jobTitle.findMany({
        select: { id: true, departmentId: true, titleEn: true, titleAr: true, minGrade: { select: { rank: true } }, maxGrade: { select: { rank: true } } },
      }),
      this.prisma.employment.groupBy({ by: ['jobTitleId'], where: current, _count: { _all: true } }),
      showsPeople
        ? this.prisma.employment.findMany({ where: current, select: { jobTitleId: true, employee: PERSON }, orderBy: { employee: { fullNameEn: 'asc' } } })
        : Promise.resolve([]),
    ]);

    const headcount = new Map(counts.map((c) => [c.jobTitleId, c._count._all]));
    const peopleOf = new Map<string, OrgChartPerson[]>();
    for (const h of holders) {
      if (!h.jobTitleId) continue;
      const list = peopleOf.get(h.jobTitleId);
      if (list) list.push(h.employee);
      else peopleOf.set(h.jobTitleId, [h.employee]);
    }

    const titlesOf = new Map<string, OrgChartJobTitle[]>();
    for (const t of [...titles].sort(byGrade)) {
      const title: OrgChartJobTitle = { id: t.id, titleEn: t.titleEn, titleAr: t.titleAr, headcount: headcount.get(t.id) ?? 0 };
      if (showsPeople) title.people = peopleOf.get(t.id) ?? [];
      const list = titlesOf.get(t.departmentId);
      if (list) list.push(title);
      else titlesOf.set(t.departmentId, [title]);
    }

    // one level only: a team's parent is a department (DepartmentsService.checkPlace), and the list is already in order
    const unit = (d: { id: string; nameEn: string; nameAr: string | null; head: OrgChartPerson | null }): OrgChartTeam => ({
      id: d.id,
      nameEn: d.nameEn,
      nameAr: d.nameAr,
      head: d.head,
      jobTitles: titlesOf.get(d.id) ?? [],
    });
    const chart = departments.filter((d) => !d.parentId).map((d): OrgChartDepartment => ({ ...unit(d), teams: [] }));
    const byId = new Map(chart.map((d) => [d.id, d]));
    for (const d of departments) {
      if (d.parentId) byId.get(d.parentId)?.teams.push(unit(d));
    }

    return {
      company: {
        nameEn: company?.nameEn ?? 'Company',
        nameAr: company?.nameAr ?? null,
        hasLogo: !!company?.logoUpdatedAt,
        logoVersion: company?.logoUpdatedAt?.getTime() ?? null,
      },
      showsPeople,
      departments: chart,
    };
  }
}
