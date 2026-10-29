// A CV's career from its work history (owner, 29 October 2026: "when calculating expirence in the scoring, make it career
// based or company based. and if the candidate is a skipper or no"). Asked, he chose:
// - "Span vs time employed", "Set per job": each vacancy counts a CV's experience company based (the months they worked at
//   companies, gaps between jobs left out: the CV's date ranges added up, overlaps merged, as before) or career based
//   (from the start of their first job to the end of their latest, today when still working there, gaps included);
// - "Short average stay": a skipper (a job-hopper) stays under a year a company on average, at least 3 companies read
//   with their dates; jobs at one company (a promotion) count as one stay;
// - "Flag + lower the score": "Skipper" shown on the CV and in the lists, and SKIPPER_PENALTY points off its CV match
//   (cv-fit.ts).
// Rules only, as the CV reading is: the work history is cv-analysis.ts's (a job per line with dates under the experience
// heading), so a CV whose jobs weren't read has no career to tell (null), never "not a skipper".
// Pure code, tested in apps/api/src/common/career.spec.ts.

import type { CvWorkEntry } from './cv-analysis.js';
import { agencyMonthsText, companyKey, monthNumber } from './marketing-agencies.js';

/** How a vacancy counts a CV's years of experience: company based (the default, as before) or career based. */
export const EXPERIENCE_BASES = ['company', 'career'] as const;
export type ExperienceBasis = (typeof EXPERIENCE_BASES)[number];
export const EXPERIENCE_BASIS_DEFAULT: ExperienceBasis = 'company';
export const EXPERIENCE_BASIS_LABELS: Record<ExperienceBasis, string> = { company: 'Company based', career: 'Career based' };

/** Each way in words, for the vacancy's form and page. */
export const EXPERIENCE_BASIS_HINTS: Record<ExperienceBasis, string> = {
  company: 'The months they worked at companies, the gaps between jobs left out.',
  career: 'From the start of their first job to the end of their latest (today when still working), the gaps included.',
};

/** A skipper: under `averageMonths` a company on average, with at least `minCompanies` companies read with their dates. */
export const SKIPPER_LIMITS = { averageMonths: 12, minCompanies: 3 } as const;

/** The points a skipper's CV match loses (never below 0). */
export const SKIPPER_PENALTY = 10;

/** The flag's word. */
export const SKIPPER_LABEL = 'Skipper';

/** A CV's career as its work history tells it. */
export interface CareerFacts {
  /**
   * From the start of the first job to the end of the latest (the month read for a current job), counted as the CV's
   * months worked are (cv-analysis.ts experienceMonths: "Jan 2021 – Aug 2021" is 7), so a career without gaps is as long
   * either way; null: no dates read.
   */
  spanMonths: number | null;
  /** The companies whose months are known (jobs at one company one). */
  companies: number;
  /** The months a company on average, whole months down; null under SKIPPER_LIMITS.minCompanies companies. */
  averageStayMonths: number | null;
  /** Under a year a company on average, with at least SKIPPER_LIMITS.minCompanies companies. */
  skipper: boolean;
}

/**
 * A CV's career from its work history (`asOf`: the month "present" means, YYYY-MM): its span and its average stay a
 * company; null without a job read (nothing to tell).
 */
export function careerOf(workHistory: readonly CvWorkEntry[] | null | undefined, asOf: string): CareerFacts | null {
  const jobs = (workHistory ?? []).filter((w) => w.pastTitle || w.pastCompany);
  if (!jobs.length) return null;
  const now = monthNumber(asOf.slice(0, 7), true);
  let first: number | null = null;
  let last: number | null = null;
  // each company's months, each month once (jobs at one company overlapping, or one after another)
  const stays = new Map<string, Set<number>>();
  for (const [i, w] of jobs.entries()) {
    const from = monthNumber(w.from, false);
    const to = w.current ? now : monthNumber(w.to, true);
    if (from !== null) first = first === null ? from : Math.min(first, from);
    if (to !== null) last = last === null ? to : Math.max(last, to);
    if (from === null || to === null || to < from) continue;
    const key = (w.pastCompany && companyKey(w.pastCompany)) || `#${i}`;
    const months = stays.get(key) ?? new Set<number>();
    for (let n = from; n <= to; n++) months.add(n);
    stays.set(key, months);
  }
  const spanMonths = first !== null && last !== null && last >= first ? last - first : null;
  const companies = stays.size;
  const total = [...stays.values()].reduce((n, s) => n + s.size, 0);
  const counted = companies >= SKIPPER_LIMITS.minCompanies;
  return {
    spanMonths,
    companies,
    averageStayMonths: counted ? Math.floor(total / companies) : null,
    skipper: counted && total / companies < SKIPPER_LIMITS.averageMonths,
  };
}

/** The average stay in words: "8 m a company on average", "1 y 2 m a company on average". */
export const averageStayText = (months: number): string => `${agencyMonthsText(months)} a company on average`;

/** The flag in words: "Skipper · 8 m a company on average"; null when not a skipper (or not told). */
export function skipperText(c: Pick<CareerFacts, 'skipper' | 'averageStayMonths'> | null | undefined): string | null {
  if (!c?.skipper) return null;
  return c.averageStayMonths !== null ? `${SKIPPER_LABEL} · ${averageStayText(c.averageStayMonths)}` : SKIPPER_LABEL;
}
