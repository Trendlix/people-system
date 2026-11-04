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

// The recruitment tree on the site (owner, 3 November 2026: "Recrutment tree"; packages/shared recruitment-tree.ts): the
// hold (Unreachable, Pending) as a badge and the lists' filter, a decision in words, and what the decision forms send.
// Pure code (relative imports), tested in tree.test.ts; the API checks everything again.

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

/** A decision in a line: "Review 1: Rejected (Culture Fit, Location)". */
export const decisionLine = (d: Pick<StepDecisionView, 'stage' | 'outcome' | 'reasons'>): string => decisionText(d, applicationStageLabel);

/** The reasons to choose from when rejecting someone at `stage` (the Technical Interview's list there, else HR Screening's). */
export const rejectReasonsAt = (stage: ApplicationStage): readonly RejectReason[] => rejectReasonsOf(isDecisionStep(stage) ? stage : 'applied');

/** What a decision form sends: its outcome, a rejection's reasons, the feedback, the email tick. */
export interface DecisionBody {
  outcome: StepOutcome;
  reasons: string[];
  feedback: string | null;
  email?: boolean;
}

/** A decision form read (the outcome chosen, or sent by the button pressed); `outcome` null when none is. */
export function decisionOf(fd: FormData, outcome?: string | null): { body: DecisionBody | null; errors: string[] } {
  const chosen = outcome ?? fd.get('outcome');
  const reasons = [...new Set(fd.getAll('reasons').filter((v): v is string => typeof v === 'string' && v !== ''))];
  const raw = fd.get('feedback');
  const feedback = typeof raw === 'string' ? raw.trim() : '';
  const errors: string[] = [];
  if (!isStepOutcome(chosen)) errors.push('Choose the outcome.');
  else if (chosen === 'rejected' && !reasons.length) errors.push('Choose why they are rejected: one reason or more.');
  if (feedback.length > FEEDBACK_MAX) errors.push(`Keep the feedback to ${FEEDBACK_MAX} characters or fewer.`);
  if (errors.length) return { body: null, errors };
  const o = chosen as StepOutcome;
  return { body: { outcome: o, reasons: o === 'rejected' ? reasons : [], feedback: feedback || null, ...(o === 'rejected' && fd.get('email') === 'on' && { email: true }) }, errors: [] };
}
