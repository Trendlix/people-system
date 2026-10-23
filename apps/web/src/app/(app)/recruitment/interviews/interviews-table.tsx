import Link from 'next/link';
import { INTERVIEW_KIND_LABELS, INTERVIEW_STATUS_LABELS, type InterviewView } from '@trendlix/shared';
import { formatDateTime } from '@/lib/format';
import { applicantHref } from '../recruitment';
import { joinShown } from '@/lib/hidden';

// Interviews in a table (Phase 2, 22 October 2026): when, the applicant and their vacancy, how, the interviewers (and
// whether each gave their scorecard), where it stands. On Interviews and My Hiring.

export function InterviewsTable({ rows, showFeedbackFor }: { rows: InterviewView[]; showFeedbackFor?: string | null }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Applicant</th>
            <th>How</th>
            <th>Interviewers</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => {
            const mine = showFeedbackFor ? i.interviewers.find((x) => x.employeeId === showFeedbackFor) : undefined;
            return (
              <tr key={i.id}>
                <td className="text-sm whitespace-nowrap">
                  {formatDateTime(i.startsAt)}
                  <span className="block text-xs text-muted">{i.minutes} minutes</span>
                </td>
                <td>
                  <Link href={applicantHref(i.application.id)} className="font-semibold">
                    {i.application.fullName}
                  </Link>
                  <span className="block text-xs text-muted">
                    {joinShown([i.application.vacancy.title, i.application.number])}
                  </span>
                </td>
                <td className="text-sm">{INTERVIEW_KIND_LABELS[i.kind]}</td>
                <td className="text-sm">{i.interviewers.map((x) => x.name).join(', ')}</td>
                <td className="text-sm">
                  {INTERVIEW_STATUS_LABELS[i.status]}
                  {mine && i.can.feedback && !mine.feedbackGiven && <span className="block text-xs font-semibold text-warn">Your scorecard is due</span>}
                  {i.emailProblem && <span className="block text-xs text-warn">Candidate not emailed</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
