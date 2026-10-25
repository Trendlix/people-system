import {
  APPLICATION_STAGES,
  applicationSourceOf,
  cvFactsOf,
  cvFitFrom,
  cvMonthsAtLeast,
  experienceOf,
  isGeneralCvSource,
  tidyQuestions,
  vacancyQuestionsProblems,
  type AnswerValue,
  type ApplicationListItem,
  type ApplicationStage,
  type CvListFacts,
  type CvReadingStatus,
  type EmploymentType,
  type PublicVacancySummary,
  type RecruitmentUserRef,
  type VacancyListItem,
  type VacancyQuestion,
  type VacancyStatus,
  type WorkArrangement,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isConfidentialVacancy } from './recruitment-access.js';

// How vacancies and applications are read and shown (owner, 22 October 2026: "where will we include the ATS?";
// packages/shared recruitment.ts). Pure, but for the shapes Prisma reads.

export const VACANCY_ENTITY = 'vacancy';
export const APPLICATION_ENTITY = 'job_application';

const USER = { select: { id: true, email: true } } as const;

/** What a vacancy is read with, on the list and its page. */
export const VACANCY_INCLUDE = {
  jobTitle: { select: { id: true, titleEn: true, minGrade: { select: { confidential: true } } } },
  department: { select: { id: true, nameEn: true } },
  grade: { select: { id: true, code: true, levelEn: true, confidential: true } },
  hiringManager: { select: { id: true, fullNameEn: true } },
  shift: { select: { id: true, code: true } },
  submittedBy: USER,
  decidedBy: USER,
  createdBy: USER,
} satisfies Prisma.VacancyInclude;

export type VacancyRow = Prisma.VacancyGetPayload<{ include: typeof VACANCY_INCLUDE }>;

/** A vacancy's questions as kept: those passing the rules (a row saved before them, or broken, as none). */
export function questionsOf(value: Prisma.JsonValue): VacancyQuestion[] {
  if (!Array.isArray(value)) return [];
  return vacancyQuestionsProblems(value).length ? [] : tidyQuestions(value as unknown as VacancyQuestion[]);
}

/** An application's answers as kept: by question key. */
export function answersOf(value: Prisma.JsonValue): Record<string, AnswerValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, AnswerValue> = {};
  for (const [k, v] of Object.entries(value)) out[k] = typeof v === 'string' || typeof v === 'number' ? v : null;
  return out;
}

export const money = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

export const userRef = (u: { id: string; email: string } | null, names: ReadonlyMap<string, { name: string }>): RecruitmentUserRef | null =>
  u ? { email: u.email, name: names.get(u.id)?.name ?? null } : null;

/** Applicants by stage, and those filtered out, of each vacancy. */
export interface VacancyCounts {
  byStage: Record<ApplicationStage, number>;
  filteredOut: number;
  total: number;
}

export const emptyCounts = (): VacancyCounts => ({ byStage: Object.fromEntries(APPLICATION_STAGES.map((s) => [s, 0])) as Record<ApplicationStage, number>, filteredOut: 0, total: 0 });

export function vacancyListView(v: VacancyRow, counts: VacancyCounts): VacancyListItem {
  return {
    id: v.id,
    number: v.number,
    slug: v.slug,
    title: v.title,
    status: v.status as VacancyStatus,
    jobTitle: { id: v.jobTitle.id, titleEn: v.jobTitle.titleEn },
    department: v.department,
    employmentType: v.employmentType as EmploymentType,
    headcount: v.headcount,
    hired: counts.byStage.hired,
    applicants: counts.total,
    toReview: counts.byStage.applied - counts.filteredOut > 0 ? counts.byStage.applied - counts.filteredOut : 0,
    closingDate: fromDateOnly(v.closingDate),
    publishedAt: v.publishedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    confidential: isConfidentialVacancy(v),
  };
}

/** What an application is read with on the lists. */
export const APPLICATION_LIST_SELECT = {
  id: true,
  number: true,
  vacancy: { select: { id: true, number: true, title: true, status: true } },
  fullName: true,
  email: true,
  mobile: true,
  stage: true,
  filteredOut: true,
  matchPercent: true,
  // the CV match % (22 October 2026), the CV fit's since 25 October 2026, and the fit's parts for the breakdown
  cvMatchPercent: true,
  cvFit: true,
  points: true,
  maxPoints: true,
  yearsExperience: true,
  source: true,
  createdAt: true,
  // moved from a general CV (22 October 2026): where that CV came from
  generalCv: { select: { source: true } },
  // the candidate's profile, for the badges (22 October 2026)
  candidateId: true,
  // the CV's reading, for the Experience and Latest role columns (24 October 2026)
  cv: { select: { sizeBytes: true } },
  cvReading: { select: { status: true, facts: true } },
} satisfies Prisma.JobApplicationSelect;

export type ApplicationListRow = Prisma.JobApplicationGetPayload<{ select: typeof APPLICATION_LIST_SELECT }>;

export const applicationListView = (a: ApplicationListRow): ApplicationListItem => ({
  id: a.id,
  number: a.number,
  vacancy: { id: a.vacancy.id, number: a.vacancy.number, title: a.vacancy.title, status: a.vacancy.status as VacancyStatus },
  fullName: a.fullName,
  email: a.email,
  mobile: a.mobile,
  stage: a.stage as ApplicationStage,
  filteredOut: a.filteredOut,
  matchPercent: a.matchPercent,
  cvMatchPercent: a.cvMatchPercent,
  cvFit: cvFitFrom(a.cvFit),
  points: a.points,
  maxPoints: a.maxPoints,
  yearsExperience: money(a.yearsExperience),
  source: applicationSourceOf(a.source),
  generalSource: a.generalCv && isGeneralCvSource(a.generalCv.source) ? a.generalCv.source : null,
  appliedAt: a.createdAt.toISOString(),
  fromCv: cvListFactsOf(!!a.cv, a.cvReading),
});

// ---------- the CV's years and facts on the lists (24 October 2026) ----------
// The owner, 24 October 2026, on the General CVs list (the Experience column "—" on every row): "why isn't the
// experience pulled off the CV?"; chose "CV years in list + more rules": the years typed, else the CV's estimate, in the
// column and its filter alike (packages/shared cv-analysis.ts experienceOf, meetsMinYears).

/**
 * What a list shows of a CV's reading: its status ("Reading…"), its months of experience and its latest job; a CV
 * without a reading yet (come in a moment ago) as being read. Null without a CV.
 */
export function cvListFactsOf(hasCv: boolean, reading: { status: string; facts: Prisma.JsonValue | null } | null): CvListFacts | null {
  if (!hasCv) return null;
  if (!reading) return { status: 'pending', experienceMonths: null, latestTitle: null, latestCompany: null };
  const facts = reading.status === 'read' ? cvFactsOf(reading.facts) : null;
  return { status: reading.status as CvReadingStatus, experienceMonths: facts?.experienceMonths ?? null, latestTitle: facts?.latestTitle ?? null, latestCompany: facts?.latestCompany ?? null };
}

/**
 * ?minYears= on an application's or a general CV's list: the years typed at least `min`, or none typed and the CV's
 * dates at least as many (as the column rounds them: 3+ is 30 months).
 */
export const minYearsWhere = (min: number) => ({
  OR: [{ yearsExperience: { gte: min } }, { yearsExperience: null, cvReading: { is: { status: 'read', facts: { path: ['experienceMonths'], gte: cvMonthsAtLeast(min) } } } }],
});

/** ?skill= (a dictionary skill, skills-dictionary.ts): the CVs whose reading found it. */
export const skillWhere = (skill: string) => ({ cvReading: { is: { status: 'read', facts: { path: ['cvSkills'], array_contains: [skill] } } } });

/**
 * Most experience first (?sort=years): the years the column shows (typed, else the CV's as rounded), then the months,
 * none last; a stable sort, so equals keep their order.
 */
export function byExperience<T>(rows: readonly T[], of: (row: T) => { typed: number | null; cvMonths: number | null }): T[] {
  const key = (row: T) => {
    const { typed, cvMonths } = of(row);
    const shown = experienceOf(typed, cvMonths);
    return shown ? [shown.years, typed !== null ? typed * 12 : (cvMonths ?? 0)] : null;
  };
  const keyed = rows.map((row) => ({ row, k: key(row) }));
  return keyed
    .sort((a, b) => {
      if (!a.k || !b.k) return a.k ? -1 : b.k ? 1 : 0;
      return b.k[0] - a.k[0] || b.k[1] - a.k[1];
    })
    .map((x) => x.row);
}

/** An open vacancy as the careers page lists it. */
export const publicSummaryOf = (v: {
  slug: string;
  title: string;
  department: { nameEn: string } | null;
  employmentType: string;
  workArrangement: string;
  closingDate: Date | null;
  publishedAt: Date | null;
}): PublicVacancySummary => ({
  slug: v.slug,
  title: v.title,
  department: v.department?.nameEn ?? null,
  employmentType: v.employmentType as EmploymentType,
  workArrangement: v.workArrangement as WorkArrangement,
  closingDate: fromDateOnly(v.closingDate),
  publishedAt: v.publishedAt?.toISOString() ?? null,
});
