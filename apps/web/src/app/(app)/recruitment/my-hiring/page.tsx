import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { APPLICATION_STAGE_LABELS, HIRING_MANAGER_STAGES } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { loadMyHiring, recruitmentNotLoaded } from '../data';
import { InterviewsTable } from '../interviews/interviews-table';
import { boardHref } from '../hiring';
import { ShortlistToReview } from '../shortlist-review';

// My Hiring (Phase 2, owner, 22 October 2026; the brief: "Show it only to people who are a hiring manager or interviewer
// on something open"): the open vacancies the person hires for, with their applicants from Shortlisted on, and the
// interviews they sit on (to come, and those of the last 60 days, a scorecard due marked).

export const metadata: Metadata = { title: 'My Hiring · People System' };

async function Mine() {
  const [user, loaded] = await Promise.all([getCurrentUser(), loadMyHiring()]);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'hiring')}</Empty>;
  const { vacancies, interviews, feedbackDue } = loaded.value;
  if (!vacancies.length && !interviews.length) return <Empty>Nothing to hire for or interview yet: HR adds you as a vacancy’s hiring manager or an interviewer.</Empty>;
  return (
    <div className="space-y-6">
      {feedbackDue > 0 && (
        <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {feedbackDue} {feedbackDue === 1 ? 'scorecard is' : 'scorecards are'} waiting for you: open the applicant to give it.
        </p>
      )}
      {/* the shortlists HR sent them, to accept or reject (owner, 29 October 2026: "Manager view the shortlisted and accept or reject them") */}
      <ShortlistToReview groups={loaded.value.toReview ?? []} hires={vacancies.length > 0} />
      {vacancies.length > 0 && (
        <section aria-labelledby="my-vacancies" className="space-y-3">
          <h2 id="my-vacancies" className="text-lg font-semibold">
            Vacancies I Hire For
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {vacancies.map((v) => (
              <li key={v.id} className="card space-y-2 p-4">
                <Link href={boardHref(v.id)} className="font-semibold">
                  {v.title}
                </Link>
                <p className="text-xs text-muted">{v.number}</p>
                <p className="text-sm">
                  {HIRING_MANAGER_STAGES.map((s) => `${APPLICATION_STAGE_LABELS[s]} ${v.counts[s]}`).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {interviews.length > 0 && (
        <section aria-labelledby="my-interviews" className="space-y-3">
          <h2 id="my-interviews" className="text-lg font-semibold">
            My Interviews
          </h2>
          <InterviewsTable rows={interviews} showFeedbackFor={user.employeeId ?? null} />
        </section>
      )}
    </div>
  );
}

export default function MyHiringPage() {
  return (
    <div className="max-w-5xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">My Hiring</h1>
        <p className="max-w-3xl text-sm text-muted">
          The vacancies you hire for, from Shortlisted on, and the interviews you sit on. Give your scorecard on the applicant’s page after each interview.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Mine />
      </Suspense>
    </div>
  );
}
