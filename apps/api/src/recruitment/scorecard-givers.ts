import { seesConfidential, type FeedbackView, type InterviewView, type Role } from '@trendlix/shared';

// Who gives a scorecard on an interview (owner, 29 October 2026: "then there should be interview comment and status for
// HR and hiring manager"; asked, "Score Card for each of them"; packages/shared hiring-steps.ts, step 5): its
// interviewers, as before, and, even when not among them, the vacancy's hiring manager and HR (or a Super Admin; the CEO
// on a C-level vacancy, which stays with the CEO and a Super Admin), each through their own employee profile, one
// scorecard each an interview. Each scorecard says whose it is: an interviewer's, else the hiring manager's, else HR's.
// Pure; tested in scorecard-givers.spec.ts.

/** Whose a scorecard is: one of the interview's interviewers, the vacancy's hiring manager, or HR. */
export type ScorecardRole = NonNullable<FeedbackView['role']>;

/**
 * An interview as the API answers it: with whether the caller gave their scorecard on it, for "Scorecard due" on My
 * Hiring (HR and the hiring manager aren't on its interviewers' list). Not in packages/shared's InterviewView yet: a
 * page reading an API from before it finds it missing.
 */
export type InterviewAnswer = InterviewView & { myFeedbackGiven: boolean };

/** Said to HR (or the CEO) whose user isn't linked to an employee profile: a scorecard is a person's. */
export const NO_PROFILE_FOR_SCORECARD = 'Your user has no employee profile, so it can’t give a scorecard.';

export const NOT_A_SCORER = 'Only its interviewers, the vacancy’s hiring manager and HR give a scorecard on an interview.';

/**
 * Whether the caller gives a scorecard as HR: HR or a Super Admin (they manage recruitment); the CEO too on a C-level
 * vacancy, which HR never sees.
 */
export function scoresAsHr(c: { manages: boolean; user: { roles: readonly Role[] } }, confidentialVacancy: boolean): boolean {
  return c.manages || (confidentialVacancy && seesConfidential(c.user));
}

/**
 * Whose scorecard a person gives on an interview: 'interviewer' when on its panel, else 'hiring_manager' when the
 * vacancy's hiring manager, else 'hr' when they score as HR (`asHr`); null when none of these (or no employee profile).
 */
export function scorecardRole(employeeId: string | null | undefined, interview: { interviewerIds: readonly string[]; hiringManagerId: string | null }, asHr: boolean): ScorecardRole | null {
  if (!employeeId) return null;
  if (interview.interviewerIds.includes(employeeId)) return 'interviewer';
  if (interview.hiringManagerId === employeeId) return 'hiring_manager';
  return asHr ? 'hr' : null;
}

/**
 * Whose a scorecard given is: an interviewer's or the hiring manager's as they stand now, else HR's (who else could
 * give it).
 */
export const givenScorecardRole = (employeeId: string, interview: { interviewerIds: readonly string[]; hiringManagerId: string | null }): ScorecardRole =>
  scorecardRole(employeeId, interview, true) ?? 'hr';
