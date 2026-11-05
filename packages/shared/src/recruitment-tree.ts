// The recruitment tree (owner, 3 November 2026: "Recrutment tree"; asked, "HR1 (Recruter) - HR2 (Her MAnager if there is)
// - then Manager", "Declined closes, rest stay", "Reason list + feedback", "By progress", "Wait in Applicants", "A
// Recruiter field", "Yes, at once"; 5 November 2026: "Consolidate all incoming applicant data directly into the Review 1
// tab (renamed 'Applicants'), making the Review 2 tab the final review stage"; asked, "Recruiter's manager", "optional
// Feedback", "A filter in Applicants", "On to HR Screening"). An application goes through:
// 1. Applicants: every CV that came in, reviewed by the vacancy's recruiter (an HR person named on the vacancy, by default
//    whoever made it): the first CV filtration. One a must-have question filtered out waits here until restored.
// 2. Final Review: the recruiter's direct manager, when the recruiter has one: the second filtration. None: skipped.
//    Each review passes the applicant on or rejects them, with optional feedback and no reasons (the reasons are HR
//    Screening's and the interview's). The hiring manager's own CV review of before is gone: they see their vacancy's
//    applicants from HR Screening on.
// 3. HR Screening (HR's call): Accepted (on to the interview), Rejected (its reasons), Unreachable (kept here, to try
//    again).
// 4. Technical Interview (scheduled as before): Accepted (on to the offer), Rejected (its reasons), Pending (awaiting the
//    candidate's answer), Unreachable (could not be contacted), Declined (the candidate declined: closed). Pending and
//    Unreachable keep them at the interview.
// 5. Offer: Make offer, then the job offer's cycle as before (accepted: hired).
// A rejection at a review is listed under Applicants ("Rejected at review"), the others on the Rejected tab
// (recruitment.ts rejectedAtReview).
// Each decision has a written feedback field, and is kept in the application's history with who and when. A Super Admin
// may take any step. When nobody is named for a review (no recruiter) HR takes it, so nobody waits for no one. Pure code: the API enforces these rules, the web shows them. Tested in
// apps/api/src/common/recruitment-tree.spec.ts.

// ---------- the steps ----------

/** The CV reviews, in order: Applicants (the recruiter's) and the Final Review (the recruiter's manager's). */
export const REVIEW_STAGES = ['applied', 'review_2'] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];
export const isReviewStage = (value: unknown): value is ReviewStage => (REVIEW_STAGES as readonly unknown[]).includes(value);

/** The steps decided with an outcome: the reviews (Applicants, the Final Review), HR Screening and the Technical Interview. */
export const DECISION_STEPS = [...REVIEW_STAGES, 'screening', 'interview'] as const;
export type DecisionStep = (typeof DECISION_STEPS)[number];
export const isDecisionStep = (value: unknown): value is DecisionStep => (DECISION_STEPS as readonly unknown[]).includes(value);

// ---------- the outcomes ----------

export const STEP_OUTCOMES = ['passed', 'accepted', 'rejected', 'unreachable', 'pending', 'declined'] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];
export const isStepOutcome = (value: unknown): value is StepOutcome => (STEP_OUTCOMES as readonly unknown[]).includes(value);

export const STEP_OUTCOME_LABELS: Record<StepOutcome, string> = {
  passed: 'Passed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  unreachable: 'Unreachable',
  pending: 'Pending',
  declined: 'Declined',
};

/** What an outcome means, in a few words beside it. */
export const STEP_OUTCOME_NOTES: Partial<Record<StepOutcome, string>> = {
  pending: 'Awaiting the candidate’s response',
  unreachable: 'The candidate could not be contacted',
  declined: 'The candidate declined',
};

/** The outcomes each step takes, in the order they are offered. */
export const STEP_OUTCOMES_OF: Record<DecisionStep, readonly StepOutcome[]> = {
  applied: ['passed', 'rejected'],
  review_2: ['passed', 'rejected'],
  screening: ['accepted', 'rejected', 'unreachable'],
  interview: ['accepted', 'rejected', 'pending', 'unreachable', 'declined'],
};

/** What an outcome does: on to the next step, closed as rejected, kept at the step, or closed as declined. */
export type OutcomeEffect = 'next' | 'reject' | 'hold' | 'decline';
export const OUTCOME_EFFECT: Record<StepOutcome, OutcomeEffect> = {
  passed: 'next',
  accepted: 'next',
  rejected: 'reject',
  unreachable: 'hold',
  pending: 'hold',
  declined: 'decline',
};

/** The outcomes that keep an applicant at their step (kept on the application as its hold until the step changes). */
export const HOLD_OUTCOMES = ['unreachable', 'pending'] as const;
export type HoldOutcome = (typeof HOLD_OUTCOMES)[number];
export const isHoldOutcome = (value: unknown): value is HoldOutcome => (HOLD_OUTCOMES as readonly unknown[]).includes(value);

// ---------- the reasons ----------

/** The HR Screening's rejection reasons ("Reason list + feedback"); a hand rejection at the Offer takes them too. */
export const SCREENING_REJECT_REASONS = ['culture_fit', 'underqualified', 'overqualified', 'attitude', 'salary_expectations', 'notice_period', 'objectives_mismatch', 'location'] as const;
/** The Technical Interview's rejection reasons. */
export const INTERVIEW_REJECT_REASONS = ['culture_fit', 'underqualified', 'skills_mismatch', 'overqualified', 'no_show', 'attitude'] as const;

export type RejectReason = (typeof SCREENING_REJECT_REASONS)[number] | (typeof INTERVIEW_REJECT_REASONS)[number];

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  culture_fit: 'Culture Fit',
  underqualified: 'Underqualified',
  overqualified: 'Overqualified',
  attitude: 'Attitude',
  salary_expectations: 'Salary Expectations',
  notice_period: 'Notice Period',
  objectives_mismatch: 'Objectives Mismatch',
  location: 'Location',
  skills_mismatch: 'Skills Mismatch',
  no_show: 'No show',
};

/**
 * The reasons a step's rejection is chosen from: the interview's own, HR Screening's (the Offer's too), none at a review
 * (5 November 2026: Pass or Reject only, with "optional Feedback").
 */
export const rejectReasonsOf = (step: DecisionStep | 'offer'): readonly RejectReason[] =>
  step === 'interview' ? INTERVIEW_REJECT_REASONS : isReviewStage(step) ? [] : SCREENING_REJECT_REASONS;

/** The reasons in words, in the order of the step's list: "Culture Fit, Attitude". */
export const rejectReasonsText = (reasons: readonly string[]): string =>
  reasons.map((r) => (r in REJECT_REASON_LABELS ? REJECT_REASON_LABELS[r as RejectReason] : r)).join(', ');

/** The longest written feedback. */
export const FEEDBACK_MAX = 2000;

// ---------- a decision ----------

/** A decision as sent: its outcome, the reasons of a rejection, the written feedback. */
export interface StepDecisionInput {
  outcome: StepOutcome;
  reasons?: string[];
  feedback?: string | null;
}

/**
 * What is wrong with a decision at a step, each in words (none: it can be taken): an outcome the step takes; a
 * rejection with one or more of its reasons, each once (none at a review, which takes none), and no reasons otherwise;
 * feedback at most FEEDBACK_MAX. `offer`: HR's hand rejection at the Offer, with HR Screening's reasons.
 */
export function decisionProblems(step: DecisionStep | 'offer', input: { outcome?: unknown; reasons?: unknown; feedback?: unknown }): string[] {
  const problems: string[] = [];
  const takes: readonly StepOutcome[] = step === 'offer' ? ['rejected'] : STEP_OUTCOMES_OF[step];
  if (!isStepOutcome(input.outcome) || !takes.includes(input.outcome)) {
    problems.push(`Choose ${takes.map((o) => STEP_OUTCOME_LABELS[o]).join(', ').replace(/, ([^,]*)$/, ' or $1')}.`);
    return problems;
  }
  const reasons = input.reasons === undefined || input.reasons === null ? [] : input.reasons;
  if (!Array.isArray(reasons) || !reasons.every((r) => typeof r === 'string')) problems.push('Send the reasons as a list.');
  else if (input.outcome === 'rejected' && isReviewStage(step)) {
    if (reasons.length) problems.push('A review is passed or rejected: no reasons are chosen, write feedback if you like.');
  } else if (input.outcome === 'rejected') {
    const allowed = rejectReasonsOf(step);
    if (!reasons.length) problems.push('Choose why they are rejected: one reason or more.');
    else if (reasons.some((r) => !(allowed as readonly string[]).includes(r))) problems.push(`Choose the reasons from: ${allowed.map((r) => REJECT_REASON_LABELS[r]).join(', ')}.`);
    else if (new Set(reasons).size !== reasons.length) problems.push('Choose each reason once.');
  } else if (reasons.length) problems.push('Reasons are for a rejection only.');
  if (input.feedback !== undefined && input.feedback !== null && typeof input.feedback !== 'string') problems.push('Write the feedback as text.');
  else if (typeof input.feedback === 'string' && input.feedback.trim().length > FEEDBACK_MAX) problems.push(`Keep the feedback to ${FEEDBACK_MAX} characters or fewer.`);
  return problems;
}

// ---------- where a pass leads ----------

/** Who the reviews have on an application's vacancy: the recruiter's manager (the Final Review). */
export interface TreeReviewers {
  hasRecruiterManager: boolean;
}

/**
 * The step after a step passed: Applicants to the Final Review (the recruiter's manager), else to HR Screening; the
 * Final Review to HR Screening; HR Screening to the Technical Interview; the Technical Interview to the Offer.
 */
export function stageAfter(step: DecisionStep, who: TreeReviewers): 'review_2' | 'screening' | 'interview' | 'offer' {
  if (step === 'applied') return who.hasRecruiterManager ? 'review_2' : 'screening';
  if (step === 'review_2') return 'screening';
  return step === 'screening' ? 'interview' : 'offer';
}

// ---------- who decides ----------

/** Who is asked to take a step: the recruiter, the recruiter's manager, or HR. */
export type StepActor = 'recruiter' | 'recruiter_manager' | 'hr';

export const STEP_ACTOR: Record<DecisionStep, StepActor> = {
  applied: 'recruiter',
  review_2: 'recruiter_manager',
  screening: 'hr',
  interview: 'hr',
};

/** Who takes each step, in words ("The recruiter"). */
export const STEP_ACTOR_LABELS: Record<StepActor, string> = {
  recruiter: 'The recruiter',
  recruiter_manager: 'The recruiter’s manager',
  hr: 'HR',
};

/** What the rules know of the caller and the application's vacancy. */
export interface TreeCaller {
  /** HR (or a Super Admin): manages recruitment. */
  manages: boolean;
  superAdmin: boolean;
  /** The caller is the vacancy's recruiter, the recruiter's manager. */
  isRecruiter: boolean;
  isRecruiterManager: boolean;
  /** The vacancy names a recruiter; the recruiter has a manager. */
  hasRecruiter: boolean;
  hasRecruiterManager: boolean;
}

/**
 * Whether the caller decides a step: a Super Admin any; the recruiter Applicants, the recruiter's manager the Final
 * Review, each its own; HR HR Screening and the Technical Interview; a review nobody is named for (no recruiter, no
 * manager of theirs) HR.
 */
export function takesStep(step: DecisionStep, c: TreeCaller): boolean {
  if (c.superAdmin) return true;
  switch (STEP_ACTOR[step]) {
    case 'hr':
      return c.manages;
    case 'recruiter':
      return c.hasRecruiter ? c.isRecruiter : c.manages;
    case 'recruiter_manager':
      return c.hasRecruiterManager ? c.isRecruiterManager : c.manages;
  }
}

/** Why the caller can't take a step (null: they can), in words. */
export function takesStepProblem(step: DecisionStep, c: TreeCaller): string | null {
  if (takesStep(step, c)) return null;
  const who = STEP_ACTOR[step];
  return `${STEP_ACTOR_LABELS[who]} takes this step.`;
}

// ---------- the history ----------

/** A decision as an application's history shows it: at a step of now, or of before (Review 1, the hiring manager's review). */
export interface StepDecisionView {
  id: string;
  stage: string;
  outcome: StepOutcome;
  reasons: RejectReason[];
  feedback: string | null;
  by: { email: string; name: string | null } | null;
  at: string;
}

/** A decision in words: "Review 1: Rejected (Culture Fit, Attitude)". */
export function decisionText(d: Pick<StepDecisionView, 'stage' | 'outcome' | 'reasons'>, stageLabel: (stage: string) => string): string {
  const reasons = d.reasons.length ? ` (${rejectReasonsText(d.reasons)})` : '';
  return `${stageLabel(d.stage)}: ${STEP_OUTCOME_LABELS[d.outcome]}${reasons}`;
}
