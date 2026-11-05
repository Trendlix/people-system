import { APPLICATION_STAGE_LABELS, type ApplicationStage, type DecisionStep, type HiringBatchResult } from '@trendlix/shared';

// The batches (owner, 29 October 2026: "Tick several at once" and "One message per batch"; the recruitment tree, 3
// November 2026): which applicants a batch skips and why, in words, and the order My Hiring lists the reviews waiting
// in. A step's decisions take those at that step (5 November 2026: Applicants decided too, no Send to Review 1). Pure; tested in apps/api/src/common/hiring-batches.spec.ts.

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

/** Why a batch of decisions at `step` skips an applicant; null when they are decided. Only those at that step of this vacancy. */
export function decideSkip(a: BatchApplicant, vacancyId: string, step: DecisionStep): string | null {
  if (a.vacancyId !== vacancyId) return OTHER_VACANCY;
  if (a.filteredOut) return 'They failed a must-have question and were filtered out.';
  if (a.stage === step) return null;
  if (a.stage === 'rejected') return 'They were rejected already.';
  const label = APPLICATION_STAGE_LABELS[a.stage as ApplicationStage] ?? a.stage;
  return `They are at ${label}: only those at ${APPLICATION_STAGE_LABELS[step]} are decided here.`;
}

/**
 * Applicants waiting for a review as My Hiring lists them: the longest waiting first, then the best match (the screening
 * questions' %, else the CV match's; none last), then by name.
 */
export function reviewOrder<T extends { since: string | null; matchPercent: number | null; cvMatchPercent: number | null; fullName: string }>(rows: readonly T[]): T[] {
  const match = (r: T) => r.matchPercent ?? r.cvMatchPercent;
  return [...rows].sort((a, b) => {
    if (a.since !== b.since) return a.since === null ? 1 : b.since === null ? -1 : a.since.localeCompare(b.since);
    const ma = match(a);
    const mb = match(b);
    if (ma !== mb) return ma === null ? 1 : mb === null ? -1 : mb - ma;
    return a.fullName.localeCompare(b.fullName);
  });
}
