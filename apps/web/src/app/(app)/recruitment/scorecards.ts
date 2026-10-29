import { RECOMMENDATION_LABELS, RECOMMENDATIONS, type FeedbackView, type InterviewView, type Recommendation } from '@trendlix/shared';
import { applicantHref } from './recruitment';

// Scorecards from HR and the hiring manager (owner, 29 October 2026: "then there should be interview comment and status
// for HR and hiring manager"; asked, "Score Card for each of them"; packages/shared hiring-steps.ts, step 5): besides an
// interview's interviewers, the vacancy's hiring manager and HR give a scorecard on it too. Each scorecard shows whose
// it is, a line above them sums them up for choosing the candidate ("then the candidate to be selected": HR then Make
// offer), and My Hiring marks the interviews whose scorecard is still due. Pure code (relative imports), tested in
// scorecards.test.ts; the API decides who may give one (InterviewView.can.feedback).

export type ScorecardRole = NonNullable<FeedbackView['role']>;

export const SCORECARD_ROLE_LABELS: Record<ScorecardRole, string> = { interviewer: 'Interviewer', hiring_manager: 'Hiring manager', hr: 'HR' };

/** A scorecard's badge: whose it is; none from an API before 29 October 2026, which didn't say. */
export const scorecardRoleLabel = (f: Pick<FeedbackView, 'role'>): string | null => (f.role ? SCORECARD_ROLE_LABELS[f.role] : null);

const said = (r: Recommendation) => RECOMMENDATION_LABELS[r];

/** "Yes" for one; "1 Strong yes, 2 No" for several, in the recommendations' order. */
function tally(recommendations: readonly Recommendation[]): string {
  if (recommendations.length === 1) return said(recommendations[0]);
  return RECOMMENDATIONS.map((r) => [r, recommendations.filter((x) => x === r).length] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n} ${said(r)}`)
    .join(', ');
}

/**
 * The line above an applicant's scorecards (those the caller sees): "Scorecards: HR Yes · Hiring manager Strong yes · 2
 * interviewers (1 Yes, 1 No)"; several of HR's or the hiring manager's (several interviews) counted the same way. One
 * without its role (an API from before 29 October 2026) is an interviewer's, the only ones then. Null for none.
 */
export function scorecardSummary(feedback: readonly Pick<FeedbackView, 'role' | 'recommendation'>[]): string | null {
  if (!feedback.length) return null;
  const of = (role: ScorecardRole) => feedback.filter((f) => (f.role ?? 'interviewer') === role).map((f) => f.recommendation);
  const hr = of('hr');
  const hm = of('hiring_manager');
  const panel = of('interviewer');
  const parts = [
    hr.length === 1 ? `HR ${tally(hr)}` : hr.length > 1 ? `${hr.length} from HR (${tally(hr)})` : null,
    hm.length === 1 ? `Hiring manager ${tally(hm)}` : hm.length > 1 ? `${hm.length} from the hiring manager (${tally(hm)})` : null,
    panel.length ? `${panel.length} ${panel.length === 1 ? 'interviewer' : 'interviewers'} (${tally(panel)})` : null,
  ].filter((p): p is string => !!p);
  return `Scorecards: ${parts.join(' · ')}`;
}

/**
 * An interview as the API answers it since 29 October 2026: with whether the caller gave their scorecard on it (HR and
 * the hiring manager aren't on its interviewers' list). Missing from an API before it.
 */
export type InterviewWithMine = InterviewView & { myFeedbackGiven?: boolean };

/**
 * Whether the person's scorecard is due on an interview: they may give one (it took place) and haven't. From an API
 * before 29 October 2026: only as one of its interviewers.
 */
export function scorecardDue(i: Pick<InterviewWithMine, 'can' | 'interviewers' | 'myFeedbackGiven'>, selfId: string | null | undefined): boolean {
  if (!i.can.feedback) return false;
  if (typeof i.myFeedbackGiven === 'boolean') return !i.myFeedbackGiven;
  const me = selfId ? i.interviewers.find((x) => x.employeeId === selfId) : undefined;
  return !!me && !me.feedbackGiven;
}

/** Where a scorecard is given: the applicant's interviews. */
export const scorecardHref = (applicationId: string) => `${applicantHref(applicationId)}#applicant-interviews`;

/**
 * Whose scorecard the person gives on an interview they may score (the API's rule, for the words): an interviewer's
 * when on its panel, else the hiring manager's when theirs, else HR's.
 */
export function ownScorecardRole(i: Pick<InterviewView, 'interviewers'>, selfId: string | null | undefined, hiringManagerId: string | null | undefined): ScorecardRole {
  if (selfId && i.interviewers.some((x) => x.employeeId === selfId)) return 'interviewer';
  if (selfId && hiringManagerId === selfId) return 'hiring_manager';
  return 'hr';
}

/** The scorecard form's heading: "Give your scorecard", "Your scorecard" once given; as whom when not on the panel. */
export function scorecardHeading(given: boolean, role: ScorecardRole): string {
  const head = given ? 'Your scorecard' : 'Give your scorecard';
  if (role === 'hiring_manager') return `${head} as the hiring manager`;
  if (role === 'hr') return `${head} as HR`;
  return head;
}
