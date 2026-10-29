import {
  interviewGateProblem,
  isScreeningCallResult,
  screeningCallProblem,
  SCREENING_CALL_NOTE_MAX,
  type ApplicationView,
  type BoardCard,
  type HiringStep,
  type HiringStepInput,
  type ScreeningCallResult,
  type ScreeningCallView,
} from '@trendlix/shared';

// HR's screening call and the interview's gate on the site (owner, 29 October 2026: "HR Filteration and shortlisting -
// Manager view the shortlisted and accept or reject them - HR Screening and scheduling"; asked, "Screening call +
// result"; packages/shared hiring-steps.ts): the screening call's form and what the applicant's page shows of it, and why
// the board can't move a card to Interview yet. Pure code, tested in screening-call.test.ts; the API checks everything
// again.

/** What the screening call's form sends. */
export interface ScreeningCallBody {
  result: ScreeningCallResult;
  note: string | null;
}

const text = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/** The screening call's form read: Passed or Failed, and the comment (optional); every problem in words. */
export function screeningCallForm(fd: FormData): { body: ScreeningCallBody | null; errors: string[] } {
  const result = text(fd, 'result');
  const note = text(fd, 'note');
  const errors: string[] = [];
  if (!isScreeningCallResult(result)) errors.push('Choose whether they passed or failed the screening call.');
  if (note.length > SCREENING_CALL_NOTE_MAX) errors.push(`Keep the comment to ${SCREENING_CALL_NOTE_MAX} characters or fewer.`);
  if (errors.length || !isScreeningCallResult(result)) return { body: null, errors };
  return { body: { result, note: note || null }, errors: [] };
}

export const screeningCallApiPath = (applicationId: string) => `/recruitment/applications/${encodeURIComponent(applicationId)}/screening-call`;

/** What the page says once the screening call is saved. */
export const screeningCallSavedText = (result: ScreeningCallResult) =>
  result === 'passed' ? 'Saved: they passed the screening call. Schedule their interview under Interviews.' : 'Saved: they failed the screening call, so no interview can be scheduled.';

/** What the hiring steps' rules read of an applicant as the page has them. */
export const stepInputOf = (a: Pick<ApplicationView, 'stage' | 'filteredOut' | 'suggestion' | 'screeningCall' | 'hasHiringManager'>): HiringStepInput => ({
  stage: a.stage,
  filteredOut: a.filteredOut,
  hasHiringManager: !!a.hasHiringManager,
  suggestion: a.suggestion?.kind ?? null,
  screeningCall: a.screeningCall?.result ?? null,
});

/**
 * The applicant page's Screening Call card: the call made (its result, comment, who and when) and, for HR (or a Super
 * Admin) at Shortlisted, the form to make it (again), or why it can't be made yet ("Waiting for the hiring manager to
 * accept them."). Null: nothing to show (no call, and not HR's to make now; or an API before the hiring steps).
 */
export function screeningCallCard(
  a: Pick<ApplicationView, 'viewer' | 'stage' | 'filteredOut' | 'suggestion' | 'screeningCall' | 'hasHiringManager'>,
): { call: ScreeningCallView | null; form: boolean; problem: string | null } | null {
  if (a.hasHiringManager === undefined) return null;
  const call = a.screeningCall ?? null;
  if (a.viewer !== 'manages' || a.stage !== 'shortlisted') return call ? { call, form: false, problem: null } : null;
  const problem = screeningCallProblem(stepInputOf(a));
  return { call, form: problem === null, problem };
}

/** A shortlisted applicant as each hiring step stands, for the interview gate's words (hiringStepOf gives each back). */
export const STEP_STANDING: Readonly<Record<HiringStep, HiringStepInput>> = {
  to_review: { stage: 'shortlisted', hasHiringManager: true, suggestion: null, screeningCall: null },
  manager_rejected: { stage: 'shortlisted', hasHiringManager: true, suggestion: 'reject', screeningCall: null },
  call_due: { stage: 'shortlisted', hasHiringManager: false, suggestion: null, screeningCall: null },
  call_failed: { stage: 'shortlisted', hasHiringManager: false, suggestion: null, screeningCall: 'failed' },
  ready: { stage: 'shortlisted', hasHiringManager: false, suggestion: null, screeningCall: 'passed' },
};

/**
 * Why a board card can't go to Interview yet (dragged there, or chosen under Move to): a shortlisted card's hiring step
 * in the API's words (interviewGateProblem); null when it can, or when the card doesn't say (the API decides).
 */
export function boardInterviewProblem(card: Pick<BoardCard, 'stage' | 'hiringStep'>): string | null {
  if (card.stage !== 'shortlisted' || !card.hiringStep) return null;
  return interviewGateProblem(STEP_STANDING[card.hiringStep]);
}
