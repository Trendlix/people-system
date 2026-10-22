import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EXIT_RATING_LABELS, EXIT_RATINGS, EXIT_REASON_LABELS, EXIT_RECOMMEND_LABELS } from '@trendlix/shared';
import { MY_REQUESTS } from '@/components/nav';
import { formatDate } from '@/lib/format';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { declineMyInterview, sendMyInterview } from '../../offboarding/actions';
import { loadMyExitInterview, offboardingNotLoaded } from '../../offboarding/data';
import { DeclineForm, ExitInterviewForm } from '../../offboarding/forms';

// The leaver's own exit interview (owner, 22 October 2026: the full module; the brief: "filled in by the employee, from
// My Requests or a link while they can still sign in"): the reason for leaving, five ratings, whether they'd recommend
// working here and comments, sent once; or "I'd rather not". HR, the CEO and a Super Admin read it, never their
// manager. Only while their offboarding case is open.

export const metadata: Metadata = { title: 'Exit Interview · People System' };

async function Interview({ searchParams }: { searchParams: PageProps<'/my-requests/exit-interview'>['searchParams'] }) {
  const [loaded, query] = await Promise.all([loadMyExitInterview(), searchParams]);
  if (loaded.kind !== 'ok') return <Empty>{offboardingNotLoaded(loaded, 'exit interview')}</Empty>;
  const i = loaded.value.interview;
  if (!i) return <Empty>There is no exit interview for you.</Empty>;
  if (i.status === 'declined') {
    return <Empty>{query.declined === '1' ? 'Noted: no exit interview. Thank you for your time here.' : 'You chose not to do the exit interview.'}</Empty>;
  }
  if (i.status === 'submitted') {
    return (
      <div className="card space-y-4 p-6">
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {query.sent === '1' ? 'Sent. Thank you: HR reads every answer.' : 'Your exit interview was sent. Thank you.'}
        </p>
        {i.answers && (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[14rem_1fr]">
            <dt className="text-muted">Main reason for leaving</dt>
            <dd>{EXIT_REASON_LABELS[i.answers.reason]}</dd>
            {EXIT_RATINGS.map((k) => (
              <div key={k} className="contents">
                <dt className="text-muted">{EXIT_RATING_LABELS[k]}</dt>
                <dd className="tabular-nums">{i.answers!.ratings[k]} of 5</dd>
              </div>
            ))}
            <dt className="text-muted">Would recommend working here</dt>
            <dd>{EXIT_RECOMMEND_LABELS[i.answers.recommend]}</dd>
            {i.answers.comments && (
              <>
                <dt className="text-muted">Comments</dt>
                <dd className="whitespace-pre-line">{i.answers.comments}</dd>
              </>
            )}
          </dl>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <ExitInterviewForm
          action={sendMyInterview}
          submitLabel="Send"
          intro={`A few questions about your time here${i.lastWorkingDay ? `, before your last working day, ${formatDate(i.lastWorkingDay)}` : ''}. HR reads your answers to make the company a better place to work; your manager never sees them. You can send them once.`}
        />
      </div>
      <div className="card p-6">
        <h2 className="mb-2 font-semibold">Rather Not?</h2>
        <DeclineForm action={declineMyInterview} label="I’d rather not do it" />
      </div>
    </div>
  );
}

export default function MyExitInterviewPage({ searchParams }: PageProps<'/my-requests/exit-interview'>) {
  return (
    <div className="max-w-4xl space-y-6">
      <BackLink href={MY_REQUESTS}>My Requests</BackLink>
      <h1 className="text-2xl font-semibold">Exit Interview</h1>
      <Suspense fallback={<Loading />}>
        <Interview searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
