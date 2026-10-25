import { cvFactsOf, minYearsWanted, prepareFitCv, prepareFitJob, type FitCv, type FitJob } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { money, questionsOf } from './recruitment-views.js';

// What the CV fit is worked out from (owner, 25 October 2026: "Full CV fit score"; packages/shared cv-fit.ts), read the
// same way wherever it is: an application's fit for its vacancy (CvReadingsService) and an earlier CV's for an open
// vacancy (VacancySuggestionsService), so the two sides of a suggestion always give the same percent.

/** What a vacancy is read with for its CV fits: its title and job title's, key skills, texts, questions and grade. */
export const FIT_VACANCY_SELECT = {
  title: true,
  keySkills: true,
  requirements: true,
  responsibilities: true,
  about: true,
  questions: true,
  jobTitle: { select: { titleEn: true } },
  grade: { select: { description: true } },
} satisfies Prisma.VacancySelect;

export type FitVacancyRow = Prisma.VacancyGetPayload<{ select: typeof FIT_VACANCY_SELECT }>;

/** A vacancy ready to score CVs against: the years asked from its texts, else its screening questions' least, else its grade. */
export const fitJobOf = (v: FitVacancyRow): FitJob =>
  prepareFitJob({
    title: v.title,
    jobTitle: v.jobTitle.titleEn,
    keySkills: v.keySkills,
    requirements: v.requirements,
    responsibilities: v.responsibilities,
    about: v.about,
    minYears: minYearsWanted(questionsOf(v.questions)),
    gradeText: v.grade?.description ?? null,
  });

/** A CV's reading as its fit reads it. */
export const FIT_READING = { select: { status: true, text: true, facts: true } } as const;

/** A general CV's position (chosen, or written for Other) as a fit counts it: a title. */
export const positionOf = (g: { positionName: string | null; positionOther: string | null } | null | undefined): string | null => (g ? (g.positionName ?? g.positionOther) : null);

/** A CV ready to be scored: read with text, its years typed, a general CV's position; null otherwise. */
export function fitCvOf(
  reading: { status: string; text: string | null; facts: Prisma.JsonValue | null } | null | undefined,
  yearsTyped: Prisma.Decimal | number | null,
  position: string | null,
): FitCv | null {
  if (!reading || reading.status !== 'read' || !reading.text) return null;
  return prepareFitCv({ text: reading.text, facts: cvFactsOf(reading.facts), yearsTyped: typeof yearsTyped === 'number' ? yearsTyped : money(yearsTyped), position });
}

/** A JSON value with its keys in order (Postgres's jsonb keeps its own order), to tell whether a kept fit changed. */
export function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    return v ?? null;
  };
  return JSON.stringify(walk(value));
}
