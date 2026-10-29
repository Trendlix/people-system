import { APPLICATION_STAGE_LABELS, stageMoveProblem, type ApplicationStage, type HiringBatchResult, type HiringSuggestion } from '@trendlix/shared';

// The hiring steps' batches (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the shortlisted and
// accept or reject them"; asked, "Tick several at once" and "One message per batch"; packages/shared hiring-steps.ts):
// which applicants a batch skips and why, in words, and the order My Hiring lists a shortlist in. HR shortlists those at
// Applied of the vacancy, as Shortlist on an applicant's page does; the hiring manager reviews those shortlisted. Pure;
// tested in apps/api/src/common/hiring-batches.spec.ts.

export const BATCH_NOT_FOUND = 'Applicant not found.';
export const OTHER_VACANCY = 'They applied to another vacancy.';

/** What a batch reads of an applicant. */
export interface BatchApplicant {
  id: string;
  number: string;
  fullName: string;
  vacancyId: string;
  stage: string;
  filteredOut: boolean;
  /** A job offer to them is open (drafted or sent). */
  openOffer?: boolean;
}

/** A batch's ids once each, in the order first listed. */
export const batchIds = (ids: readonly string[]): string[] => [...new Set(ids)];

/** One skipped, with why: their number and name when the caller may see them. */
export const skippedOf = (id: string, a: Pick<BatchApplicant, 'number' | 'fullName'> | null | undefined, reason: string): HiringBatchResult['skipped'][number] => ({
  id,
  number: a?.number ?? null,
  fullName: a?.fullName ?? null,
  reason,
});

/**
 * Why HR's shortlist skips an applicant; null when they are shortlisted. Only those at Applied of this vacancy: the stage
 * rules of Shortlist on their page (stageMoveProblem: filtered out, rejected, hired), and one at Interview, whom their
 * page may move back, is left to it.
 */
export function shortlistSkip(a: BatchApplicant, vacancyId: string): string | null {
  if (a.vacancyId !== vacancyId) return OTHER_VACANCY;
  const stage = a.stage as ApplicationStage;
  const problem = stageMoveProblem(stage, 'shortlisted', { filteredOut: a.filteredOut, openOffer: a.openOffer ?? false });
  if (problem) return problem;
  return stage === 'applied' ? null : `They are at ${APPLICATION_STAGE_LABELS[stage]}: only applicants at Applied are shortlisted together.`;
}

/** Why the hiring manager's review skips an applicant; null when it is kept. Only those shortlisted for this vacancy. */
export function reviewSkip(a: BatchApplicant, vacancyId: string): string | null {
  if (a.vacancyId !== vacancyId) return OTHER_VACANCY;
  if (a.filteredOut) return 'They failed a must-have question and were filtered out.';
  if (a.stage === 'shortlisted') return null;
  if (a.stage === 'rejected') return 'They were rejected already.';
  const label = APPLICATION_STAGE_LABELS[a.stage as ApplicationStage] ?? a.stage;
  return `They are at ${label}: only shortlisted applicants are accepted or rejected here.`;
}

const REVIEW_RANK = { none: 0, next: 1, reject: 2 } as const;

/**
 * A shortlist as My Hiring lists it: those not reviewed yet first, then those accepted, then those rejected; the best
 * match first in each (the screening questions' %, else the CV match's; none last), then by name.
 */
export function reviewOrder<T extends { suggestion: HiringSuggestion | null; matchPercent: number | null; cvMatchPercent: number | null; fullName: string }>(rows: readonly T[]): T[] {
  const match = (r: T) => r.matchPercent ?? r.cvMatchPercent;
  return [...rows].sort((a, b) => {
    const rank = REVIEW_RANK[a.suggestion ?? 'none'] - REVIEW_RANK[b.suggestion ?? 'none'];
    if (rank) return rank;
    const ma = match(a);
    const mb = match(b);
    if (ma !== mb) return ma === null ? 1 : mb === null ? -1 : mb - ma;
    return a.fullName.localeCompare(b.fullName);
  });
}
