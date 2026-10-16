import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { NoProfile } from '../dashboard/cards';
import { inDaysText } from '../dashboard/dashboard';
import { Empty, employeeRaiseRequestsHref, Loading, StatusBadge, todayInCairo } from '../employees/ui';
import { loadOwnProfile } from '../own-profile';
import { progressText } from '../raise-requests/list';
import { RaiseRequestStatusBadge } from '../raise-requests/ui';
import { loadTeam } from './data';
import { askedByText, latestRaise, probationOf } from './team';

// My Team (owner's decisions, 17 October 2026): a direct manager's direct reports, in their sidebar, so they reach
// their profiles (the Employees list isn't theirs any more). Each one with their job title and status, the probation
// end while on probation (highlighted when it is soon), and their latest raise request with where it stands (the
// manager is told, not asked, and sees no figure), with Request a raise when the manager may ask for one now (the form
// on the report's Salary sub-tab). The API decides who the manager may see, as everywhere.

export const metadata: Metadata = { title: 'My Team · People System' };

const dash = <span className="text-muted">—</span>;

async function Team() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const team = await loadTeam(profile);
  const today = todayInCairo();
  if (team.length === 0) return <Empty>No one reports to you at the moment.</Empty>;

  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Job Title</th>
            <th scope="col">Status</th>
            <th scope="col">Probation Ends</th>
            <th scope="col">Raise Requests</th>
          </tr>
        </thead>
        <tbody>
          {team.map(({ report: r, profile: theirs, raises }) => {
            const probation = probationOf(theirs?.employment, today);
            const latest = raises.kind === 'ok' ? latestRaise(raises.value.requests) : null;
            return (
              <tr key={r.id} className="align-top">
                <td>
                  <Link href={`/employees/${r.id}`} className="font-semibold">
                    {r.fullNameEn}
                  </Link>
                  <div className="text-xs text-muted tabular-nums">{r.employeeCode}</div>
                </td>
                <td>{r.jobTitle?.titleEn ?? dash}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="whitespace-nowrap">
                  {probation ? (
                    <>
                      <span className={`tabular-nums ${probation.soon ? 'font-semibold text-warn' : ''}`}>{formatDate(probation.end)}</span>
                      {probation.soon && <span className="badge ml-1.5 bg-warn-soft text-warn">{inDaysText(probation.days)}</span>}
                    </>
                  ) : (
                    dash
                  )}
                </td>
                <td className="min-w-64">
                  {raises.kind === 'failed' ? (
                    <span className="text-sm text-muted">Couldn&apos;t load.</span>
                  ) : latest ? (
                    <div className="space-y-1 text-sm">
                      <RaiseRequestStatusBadge status={latest.status} />
                      <p className="text-xs text-muted">
                        Asked by {askedByText(latest, user.email)} on <span className="tabular-nums">{formatDate(latest.createdAt)}</span> ·{' '}
                        {progressText(latest).text}
                      </p>
                    </div>
                  ) : (
                    <span className="text-sm text-muted">None yet</span>
                  )}
                  {raises.kind === 'ok' && (latest || raises.value.canRequest) && (
                    <Link href={employeeRaiseRequestsHref(r.id)} className="mt-1.5 block text-sm font-semibold">
                      {raises.value.canRequest ? 'Request a raise' : 'See the requests'}
                      <span className="sr-only"> for {r.fullNameEn}</span>
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        {team.length} {team.length === 1 ? 'person reports' : 'people report'} to you
      </p>
    </div>
  );
}

export default function MyTeamPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">My Team</h1>
      <p className="mt-1 text-muted">The people who report to you now. Open a profile to see their details and their raise requests.</p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Team />
        </Suspense>
      </div>
    </div>
  );
}
