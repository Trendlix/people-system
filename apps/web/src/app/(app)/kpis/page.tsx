import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { kpiMonthName, type KpiScorecardSummary } from '@trendlix/shared';
import { KPI_PATHS } from '@/lib/kpi-paths';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../organization/ui';
import { kpiNotLoaded, loadMyScorecards } from './data';
import { actionButton, ownCardText, percentText, scorecardsLabel } from './scorecard';
import { LevelBadge, ScoreBar, StatusBadge } from './ui';

// My KPIs (owner's brief, 21 October 2026: "My KPIs: this month's scorecard to self-rate, and the history with level and
// final % by month"): the caller's own scorecards waiting for them (to rate themself, or to sign), each with the way in,
// and every month's scorecard, newest first, with its final % and level once they are shown to the employee (from the
// sign-off: until then a dash and the step it is at). Each opens the scorecard's page. A month's scorecard opens on the
// 1st of the next month (owner, 21 October 2026: "Last month's KPI, this pay"). Someone without an employee profile has
// none.

export const metadata: Metadata = { title: 'My KPIs · People System' };

/** What waits for the employee on their own scorecards: one card each, with its deadline and the way in. */
function WaitingForYou({ scorecards }: { scorecards: KpiScorecardSummary[] }) {
  return (
    <section aria-labelledby="kpi-waiting" className="card border-accent/40 bg-accent-soft p-5">
      <h2 id="kpi-waiting" className="font-semibold">
        Waiting for You
      </h2>
      <ul className="mt-3 space-y-2">
        {scorecards.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-4 py-3">
            <span>
              <span className="block font-medium">{ownCardText(s)}</span>
              <span className="block text-xs text-muted">
                {s.action === 'self_rate'
                  ? 'Pick how you did on each metric, with a comment if you like. Your manager sees it when scoring.'
                  : 'Read the score, the picks and the comments, then sign that you have read it.'}
              </span>
            </span>
            <Link href={KPI_PATHS.scorecard(s.id)} className="btn btn-primary">
              {actionButton(s)}
              <span className="sr-only"> on your {kpiMonthName(s.month)} KPI scorecard</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every month's scorecard, newest first: the final % with a bar and the level, the step, and the way in. */
function History({ scorecards }: { scorecards: KpiScorecardSummary[] }) {
  return (
    <section aria-labelledby="kpi-history" className="card">
      <h2 id="kpi-history" className="px-5 pt-5 font-semibold">
        History
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="min-w-48">
                Final %
              </th>
              <th scope="col">Level</th>
              <th scope="col">Step</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {scorecards.map((s) => (
              <tr key={s.id} className="align-top">
                <td className="whitespace-nowrap">
                  <Link href={KPI_PATHS.scorecard(s.id)} className="font-semibold">
                    {kpiMonthName(s.month)}
                  </Link>
                  <span className="block text-xs text-muted">Template version {s.templateVersion}</span>
                </td>
                <td>
                  {s.finalPercent !== null && s.level ? (
                    <span className="flex items-center gap-3">
                      <span className="w-14 font-semibold tabular-nums">{percentText(s.finalPercent)}</span>
                      <span className="w-full max-w-40">
                        <ScoreBar percent={s.finalPercent} level={s.level} />
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className="text-muted">—</span>
                      <span className="block text-xs text-muted">{s.status === 'final' ? 'No score' : 'Shown at the sign-off'}</span>
                    </>
                  )}
                </td>
                <td>
                  <LevelBadge level={s.level} />
                </td>
                <td className="min-w-40">
                  <StatusBadge status={s.status} scorer={s.scorer.kind} />
                  {s.selfMissed && <span className="mt-1 block text-xs text-warn">Self-rating missed</span>}
                  {s.unsigned && <span className="mt-1 block text-xs text-warn">Final without every signature</span>}
                </td>
                <td className="text-right">
                  <Link href={KPI_PATHS.scorecard(s.id)} className={s.action ? 'btn btn-primary min-h-9 px-3 whitespace-nowrap' : 'text-sm font-semibold'}>
                    {actionButton(s)}
                    <span className="sr-only"> your {kpiMonthName(s.month)} KPI scorecard</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-3 text-sm text-muted">{scorecardsLabel(scorecards.length)}, newest first.</p>
    </section>
  );
}

async function Mine() {
  const user = await getCurrentUser();
  if (!user.employeeId) {
    return (
      <Empty>
        No employee record uses your sign-in email ({user.email}) as its work email, so there are no KPI scorecards for you. Ask HR to add it to
        your profile.
      </Empty>
    );
  }
  const loaded = await loadMyScorecards();
  if (loaded.kind !== 'ok') return <Empty>{kpiNotLoaded(loaded, 'scorecards')}</Empty>;
  const scorecards = loaded.value;
  const waiting = scorecards.filter((s) => s.action);
  if (!scorecards.length) {
    return (
      <Empty>
        No KPI scorecards yet. A month&apos;s scorecard opens on the 1st of the next month once HR has published the KPI template for your job
        title.
      </Empty>
    );
  }
  return (
    <div className="space-y-4">
      {waiting.length > 0 && <WaitingForYou scorecards={waiting} />}
      <History scorecards={scorecards} />
    </div>
  );
}

export default function MyKpisPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">My KPIs</h1>
      <p className="mt-1 text-muted">
        Your monthly scorecard, built from your job description: its pillars, each with its weight and its metrics. You rate yourself first, then your manager
        scores the month, HR calibrates it, and you both sign that you have read it. A month&apos;s scorecard opens on the 1st of the next month,
        and its final % counts in that month&apos;s payroll.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Mine />
        </Suspense>
      </div>
    </div>
  );
}
