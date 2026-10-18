import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { NoProfile } from '../dashboard/cards';
import { inDaysText } from '../dashboard/dashboard';
import { Empty, employeeRaiseRequestsHref, Loading, StatusBadge, todayInCairo } from '../employees/ui';
import { loadOwnProfile } from '../own-profile';
import { newRaiseRequestHref, progressText } from '../raise-requests/list';
import { RaiseRequestStatusBadge } from '../raise-requests/ui';
import { loadWaitingClaims } from '../reimbursements/data';
import { claimsLabel } from '../reimbursements/list';
import { WaitingClaimsTable } from '../reimbursements/ui';
import { loadTeam } from './data';
import { askedByText, latestRaise, probationOf } from './team';

// My Team (owner's decisions, 17 October 2026): a direct manager's direct reports, in their sidebar, so they reach
// their profiles (the Employees list isn't theirs any more). Each one with their job title and status, the probation
// end while on probation (highlighted when it is soon), and their latest raise request with where it stands (the
// manager is told, not asked, and sees no figure), with Request a raise when the manager may ask for one now: the form
// under Requests → Raise Requests with the report chosen (17 October 2026: "i think raising a request should be moved
// from the Employee tab to the raise requests tab"), else See the requests on their Salary sub-tab. The API decides who
// the manager may see, as everywhere. Reimbursements to Approve (owner, 18 October 2026: "allow the employee to add
// reimbursement request … for specific preset up conditions"): the claims waiting for the manager, the first of the
// three to decide them, each opening its page with the decision form.

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
                    <Link href={raises.value.canRequest ? newRaiseRequestHref(r.id) : employeeRaiseRequestsHref(r.id)} className="mt-1.5 block text-sm font-semibold">
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

/**
 * The claims waiting for the manager (GET /reimbursements?status=waiting), newest first: who, the type, the date and the
 * amount, each with Decide. Nothing from an API from before them.
 */
async function ToApprove() {
  const claims = await loadWaitingClaims();
  if (claims.kind === 'unavailable' || claims.kind === 'forbidden') return null;
  return (
    <section aria-labelledby="reimbursements-to-approve" className="space-y-3">
      <div>
        <h2 id="reimbursements-to-approve" className="text-lg font-semibold">
          Reimbursements to Approve
        </h2>
        <p className="text-sm text-muted">
          Your direct reports&apos; claims waiting for you. Approve one, approve a lower amount or reject it, with a comment; HR, then Finance, decide
          it after you.
        </p>
      </div>
      {claims.kind === 'failed' ? (
        <div className="card px-6 py-6 text-sm text-muted">The claims waiting for you couldn&apos;t be loaded. Please try again in a moment.</div>
      ) : claims.value.length === 0 ? (
        <div className="card px-6 py-6 text-sm text-muted">No claims are waiting for you.</div>
      ) : (
        <div className="card">
          <WaitingClaimsTable claims={claims.value} />
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{claimsLabel(claims.value.length)} waiting for you</p>
        </div>
      )}
    </section>
  );
}

export default function MyTeamPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">My Team</h1>
      <p className="mt-1 text-muted">The people who report to you now, and their reimbursement claims waiting for you. Open a profile to see their details and their raise requests.</p>
      <div className="mt-6 space-y-8">
        <Suspense fallback={null}>
          <ToApprove />
        </Suspense>
        <Suspense fallback={<Loading />}>
          <Team />
        </Suspense>
      </div>
    </div>
  );
}
