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
// on something open"): the open vacancies the person hires for, with their applicants from HR Screening on, and the
// interviews they sit on (to come, and those of the last 60 days, a scorecard due marked). Since 29 October 2026 (owner:
// "Score Card for each of them"), a hiring manager's list holds their vacancies' interviews too, though not on the panel:
// they give their scorecard on each, "Scorecard due" linking to it. Since 3 November 2026 (the recruitment tree), the
// reviews waiting for them: since 9 November 2026 their vacancies' Final Review (owner: "give the hiring manager access to
// move his batch to HR screening"), ticked and passed on to HR Screening together.

export const metadata: Metadata = { title: 'My Hiring · People System' };

async function Mine() {
  const [user, loaded] = await Promise.all([getCurrentUser(), loadMyHiring()]);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'hiring')}</Empty>;
  const { vacancies, interviews, feedbackDue } = loaded.value;
  const toReview = loaded.value.toReview ?? [];
  if (!vacancies.length && !interviews.length && !toReview.length) return <Empty>Nothing to hire for, review or interview yet.</Empty>;
  return (
    <div className="space-y-6">
      {feedbackDue > 0 && (
        <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {feedbackDue} {feedbackDue === 1 ? 'scorecard is' : 'scorecards are'} waiting for you.
        </p>
      )}
      {/* the Final Review waiting for them, to pass on to HR Screening or reject (9 November 2026: the hiring manager's); shown when something waits */}
      <ShortlistToReview groups={toReview} reviews={false} />
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
                  {HIRING_MANAGER_STAGES.map((s) => `${APPLICATION_STAGE_LABELS[s]}: ${v.counts[s]}`).join(' · ')}
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
    <div className="space-y-4">
      <h1 className="page-title">My Hiring</h1>
      <Suspense fallback={<Loading />}>
        <Mine />
      </Suspense>
    </div>
  );
}
