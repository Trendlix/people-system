import {
  APPLICATION_STAGES,
  applicationSourceOf,
  isGeneralCvSource,
  tidyQuestions,
  vacancyQuestionsProblems,
  type AnswerValue,
  type ApplicationListItem,
  type ApplicationStage,
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
  // the vacancy's key skills found in the CV (22 October 2026)
  cvMatchPercent: true,
  points: true,
  maxPoints: true,
  yearsExperience: true,
  source: true,
  createdAt: true,
  // moved from a general CV (22 October 2026): where that CV came from
  generalCv: { select: { source: true } },
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
  points: a.points,
  maxPoints: a.maxPoints,
  yearsExperience: money(a.yearsExperience),
  source: applicationSourceOf(a.source),
  generalSource: a.generalCv && isGeneralCvSource(a.generalCv.source) ? a.generalCv.source : null,
  appliedAt: a.createdAt.toISOString(),
});

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
