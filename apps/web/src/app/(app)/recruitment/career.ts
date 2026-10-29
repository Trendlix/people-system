import {
  averageStayText,
  cvFitSkipperText,
  EXPERIENCE_BASES,
  EXPERIENCE_BASIS_HINTS,
  EXPERIENCE_BASIS_LABELS,
  SKIPPER_LABEL,
  SKIPPER_LIMITS,
  SKIPPER_PENALTY,
  type CareerFacts,
  type CvFit,
  type CvListFacts,
  type ExperienceBasis,
} from '@trendlix/shared';

// A CV's career on the site (owner, 29 October 2026: "when calculating expirence in the scoring, make it career based or
// company based. and if the candidate is a skipper or no"; he chose "Span vs time employed", "Set per job", "Short
// average stay" and "Flag + lower the score"; packages/shared career.ts): the job's choice on its form and page, the
// "Skipper" flag on the CV card and in the lists, and its points off in the CV match. Pure code, tested in career.test.ts.

/** The vacancy form's field. */
export const EXPERIENCE_BASIS_FIELD = 'experienceBasis';

/** Under the choice: both ways in words. */
export const EXPERIENCE_BASIS_HINT = `How the years in a CV count in the CV match. Company based: ${EXPERIENCE_BASIS_HINTS.company.toLowerCase()} Career based: ${EXPERIENCE_BASIS_HINTS.career.toLowerCase()}`;

const isExperienceBasis = (value: string): value is ExperienceBasis => (EXPERIENCE_BASES as readonly string[]).includes(value);

/** The choice sent: company or career; null for anything else (left out: the API keeps it, or its default). */
export const vacancyExperienceBasisOf = (value: string): ExperienceBasis | null => (isExperienceBasis(value) ? value : null);

/** The choices in order, with their labels. */
export const experienceBasisChoices = (): { value: ExperienceBasis; label: string }[] => EXPERIENCE_BASES.map((value) => ({ value, label: EXPERIENCE_BASIS_LABELS[value] }));

/** The vacancy page's fact: "Career based · first job to latest, gaps included"; null from an API before it. */
export function experienceBasisText(basis: ExperienceBasis | null | undefined): string | null {
  if (!basis || !isExperienceBasis(basis)) return null;
  return `${EXPERIENCE_BASIS_LABELS[basis]} · ${basis === 'career' ? 'first job to latest, gaps included' : 'the months worked, gaps left out'}`;
}

/** Why someone is a skipper, on hover: the rule and their average. */
const skipperTitle = (averageStayMonths: number | null | undefined) =>
  `${averageStayMonths != null ? `${averageStayText(averageStayMonths)}: ` : ''}under a year a company on average (from ${SKIPPER_LIMITS.minCompanies} companies), ${SKIPPER_PENALTY} points off the CV match`;

/** A list's "Skipper" chip, its average on hover; null for anyone else, or when not told. */
export function skipperChip(fromCv: Pick<CvListFacts, 'skipper' | 'averageStayMonths'> | null | undefined): { text: string; title: string } | null {
  if (!fromCv?.skipper) return null;
  return { text: SKIPPER_LABEL, title: skipperTitle(fromCv.averageStayMonths) };
}

/**
 * The CV card's line on the career: "Skipper · 8 m a company on average" (`skipper` true), "1 y 6 m a company on average"
 * from 3 companies or more, else nothing to say (null).
 */
export function careerFlag(career: CareerFacts | null | undefined): { text: string; skipper: boolean; title: string } | null {
  if (!career || career.averageStayMonths === null) return null;
  if (career.skipper) return { text: `${SKIPPER_LABEL} · ${averageStayText(career.averageStayMonths)}`, skipper: true, title: skipperTitle(career.averageStayMonths) };
  return { text: averageStayText(career.averageStayMonths), skipper: false, title: `Not a skipper: a year or more a company on average, from ${career.companies} companies` };
}

/** The CV match's line for a skipper's points off; null for anyone else. */
export const fitSkipperLine = (fit: Pick<CvFit, 'skipper'> | null | undefined): string | null => cvFitSkipperText(fit);
