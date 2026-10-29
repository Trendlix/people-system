import type { FeedbackView } from '@trendlix/shared';
import { scorecardRoleLabel, scorecardSummary } from './scorecards';

// Scorecards' pieces (owner, 29 October 2026: "Score Card for each of them"; scorecards.ts): the badge saying whose a
// scorecard is (an interviewer's, the hiring manager's, HR's) and the line summing an applicant's up.

/** "Interviewer", "Hiring manager" or "HR" beside the name; nothing from an API before it. */
export function ScorecardRoleBadge({ f }: { f: Pick<FeedbackView, 'role'> }) {
  const label = scorecardRoleLabel(f);
  if (!label) return null;
  return <span className={`badge ml-2 align-middle font-normal ${f.role === 'interviewer' ? 'bg-canvas text-muted' : 'bg-accent-soft text-accent'}`}>{label}</span>;
}

/** "Scorecards: HR Yes · Hiring manager Strong yes · 2 interviewers (1 Yes, 1 No)"; nothing for none. */
export function ScorecardSummary({ feedback }: { feedback: readonly Pick<FeedbackView, 'role' | 'recommendation'>[] }) {
  const line = scorecardSummary(feedback);
  if (!line) return null;
  return <p className="text-sm font-medium">{line}</p>;
}
