import { agencyBackgroundOf, careerOf, cvFactsOf, minYearsWanted, prepareFitCv, prepareFitJob, type AgencyBackground, type AgencyBackgroundWanted, type AgencyMarks, type CareerFacts, type CvFacts, type ExperienceBasis, type FitCv, type FitJob } from '@trendlix/shared';
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
  // marketing agency background (27 October 2026: "Set per job")
  agencyBackground: true,
  // how it counts a CV's years (29 October 2026: "career based or company based")
  experienceBasis: true,
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
    agencyBackground: v.agencyBackground as AgencyBackgroundWanted,
    experienceBasis: v.experienceBasis as ExperienceBasis,
  });

/** A CV's reading as its fit reads it; when it was read, as "present" in its work history means that month. */
export const FIT_READING = { select: { status: true, text: true, facts: true, readAt: true } } as const;

/**
 * A CV's marketing agency background (owner, 27 October 2026: "i need a flag if the candidate is ex marketing agencies or
 * not"): its work history as of the month it was read, HR's marks winning over the names' words; null without one read.
 */
export function agencyOf(facts: CvFacts | null, readAt: Date | null | undefined, marks: AgencyMarks): AgencyBackground | null {
  return agencyBackgroundOf(facts?.workHistory, (readAt ?? new Date()).toISOString().slice(0, 7), marks);
}

/**
 * A CV's career (owner, 29 October 2026: "career based or company based", "and if the candidate is a skipper or no"):
 * its work history's span and average stay a company as of the month it was read; null without one read.
 */
export function careerFor(facts: CvFacts | null, readAt: Date | null | undefined): CareerFacts | null {
  return careerOf(facts?.workHistory, (readAt ?? new Date()).toISOString().slice(0, 7));
}

/**
 * The LinkedIn profile link a CV gave (owner, 29 October 2026: "the OCR is not filling the linkedin link like in the
 * candidate profile"): its text's, or a link behind its words (cv-text.ts); null without a reading or one.
 */
export function cvLinkedinOf(reading: { status: string; facts: Prisma.JsonValue | null } | null | undefined): string | null {
  if (!reading || reading.status !== 'read') return null;
  return cvFactsOf(reading.facts)?.linkedin ?? null;
}

/** A general CV's position (chosen, or written for Other) as a fit counts it: a title. */
export const positionOf = (g: { positionName: string | null; positionOther: string | null } | null | undefined): string | null => (g ? (g.positionName ?? g.positionOther) : null);

/** A CV ready to be scored: read with text, its years typed, a general CV's position, its agency background by `marks`; null otherwise. */
export function fitCvOf(
  reading: { status: string; text: string | null; facts: Prisma.JsonValue | null; readAt?: Date | null } | null | undefined,
  yearsTyped: Prisma.Decimal | number | null,
  position: string | null,
  marks: AgencyMarks = new Map(),
): FitCv | null {
  if (!reading || reading.status !== 'read' || !reading.text) return null;
  const facts = cvFactsOf(reading.facts);
  return prepareFitCv({ text: reading.text, facts, yearsTyped: typeof yearsTyped === 'number' ? yearsTyped : money(yearsTyped), position, agency: agencyOf(facts, reading.readAt, marks), career: careerFor(facts, reading.readAt) });
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
