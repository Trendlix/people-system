import {
  applicationStageLabel,
  decisionText,
  FEEDBACK_MAX,
  HOLD_OUTCOMES,
  isDecisionStep,
  isStepOutcome,
  rejectReasonsOf,
  type ApplicationStage,
  type HoldOutcome,
  type RejectReason,
  type StepDecisionView,
  type StepOutcome,
} from '@trendlix/shared';

// The recruitment tree on the site (owner, 3 November 2026: "Recrutment tree"; 5 November 2026: Applicants and the Final
// Review are Pass or Reject with optional feedback, no reasons; packages/shared recruitment-tree.ts): the hold
// (Unreachable, Pending) as a badge and the lists' filter, a decision in words, and what the decision forms send. Pure
// code (relative imports), tested in tree.test.ts; the API checks everything again.

/** Kept at their step, in words. */
export const HOLD_LABELS: Record<HoldOutcome, string> = { unreachable: 'Unreachable', pending: 'Pending' };

/** The Hold filter as the address carries it: one of HOLD_OUTCOMES, else '' (any). */
export function holdFilterOf(v: string | string[] | undefined): HoldOutcome | '' {
  const s = Array.isArray(v) ? v[0] : v;
  return (HOLD_OUTCOMES as readonly string[]).includes(s ?? '') ? (s as HoldOutcome) : '';
}

/** A hold's badge: its words, colours and what it means on hover; null without one. */
export function holdBadge(hold: HoldOutcome | null | undefined): { label: string; className: string; title: string } | null {
  if (!hold) return null;
  return hold === 'pending'
    ? { label: HOLD_LABELS.pending, className: 'bg-canvas text-muted', title: 'Awaiting the candidate’s response' }
    : { label: HOLD_LABELS.unreachable, className: 'bg-warn-soft text-warn', title: 'The candidate could not be contacted' };
}

/** A decision in a line: "HR Screening: Rejected (Culture Fit, Location)", "Applicants: Passed". */
export const decisionLine = (d: Pick<StepDecisionView, 'stage' | 'outcome' | 'reasons'>): string => decisionText(d, applicationStageLabel);

/**
 * The reasons to choose from when rejecting someone at `stage`: the Technical Interview's list there, HR Screening's
 * there and at the Offer, none at a review (Applicants, the Final Review).
 */
export const rejectReasonsAt = (stage: ApplicationStage): readonly RejectReason[] => rejectReasonsOf(isDecisionStep(stage) ? stage : 'offer');

/** The field a reason list puts in its form: a rejection there needs one reason or more (a review's takes none). */
export const REASONS_ASKED = 'reasonsAsked';

/** What a decision form sends: its outcome, a rejection's reasons, the feedback, the email tick. */
export interface DecisionBody {
  outcome: StepOutcome;
  reasons: string[];
  feedback: string | null;
  email?: boolean;
}

/**
 * A decision form read (the outcome chosen, or sent by the button pressed); `outcome` null when none is. A rejection needs
 * one reason or more only where the form asked for them (REASONS_ASKED: not at a review).
 */
export function decisionOf(fd: FormData, outcome?: string | null): { body: DecisionBody | null; errors: string[] } {
  const chosen = outcome ?? fd.get('outcome');
  const reasons = [...new Set(fd.getAll('reasons').filter((v): v is string => typeof v === 'string' && v !== ''))];
  const raw = fd.get('feedback');
  const feedback = typeof raw === 'string' ? raw.trim() : '';
  const errors: string[] = [];
  if (!isStepOutcome(chosen)) errors.push('Choose the outcome.');
  else if (chosen === 'rejected' && fd.get(REASONS_ASKED) === '1' && !reasons.length) errors.push('Choose why they are rejected: one reason or more.');
  if (feedback.length > FEEDBACK_MAX) errors.push(`Keep the feedback to ${FEEDBACK_MAX} characters or fewer.`);
  if (errors.length) return { body: null, errors };
  const o = chosen as StepOutcome;
  return { body: { outcome: o, reasons: o === 'rejected' ? reasons : [], feedback: feedback || null, ...(o === 'rejected' && fd.get('email') === 'on' && { email: true }) }, errors: [] };
}
