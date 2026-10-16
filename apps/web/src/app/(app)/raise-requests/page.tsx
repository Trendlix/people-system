import Link from 'next/link';
import { Suspense } from 'react';
import { Select } from '@/components/select';
import type { RaiseRequest } from '@/lib/raise-types';
import { getCurrentUser } from '@/lib/session';
import { profileHref } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { loadRaiseRequests } from './data';
import { askedAt, canSeeRaiseRequests, raiseRequestsHref, readStatus, requestsLabel, STATUS_FILTERS, type StatusFilter } from './list';
import { HrRequestActions, PreparedRaise, Progress, RaiseRequestStatusBadge, Requester, SuggestedGross } from './ui';

// Raise Requests (owner's decisions, 16 October 2026: "a place to request raise by employee, or his manager or the HR,
// with a reason and to be going through an approval cycle"): every request, newest first, filtered by status by a GET
// form so the address can be shared. HR declines a request with HR (with a reason) or prepares the raise from it, which
// goes to the CEO on Approvals; the CEO's decision on that raise is the request's. HR and the CEO see the page, and
// Finance may view it; the API checks every request again and sends the amounts only to them.

const quiet = 'border-t border-line px-4 py-10 text-center text-sm text-muted';

/** The person, linked to their Employment tab where the request and its raise are. */
const requestHref = (r: RaiseRequest) => `${profileHref(r.employee.id, 'employment')}#raise-requests`;

function Filters({ status }: { status: StatusFilter }) {
  return (
    // keyed by the status, so following a link to another (Clear) shows it, not what was chosen before
    <form key={status} className="flex flex-wrap items-end gap-3 p-4">
      <div>
        <label htmlFor="raise-request-status" className="label">
          Status
        </label>
        <Select id="raise-request-status" name="status" defaultValue={status} className="input min-w-44">
          {STATUS_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
      {status && (
        <Link href={raiseRequestsHref('')} className="btn btn-secondary">
          Clear
        </Link>
      )}
    </form>
  );
}

async function Requests({ searchParams }: { searchParams: PageProps<'/raise-requests'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeRaiseRequests(user)) return <Empty>Only HR, the CEO and Finance can see raise requests.</Empty>;
  const status = readStatus(query);
  const listing = await loadRaiseRequests(status);
  const ceo = user.roles.includes('ceo');
  const hr = user.roles.includes('hr');

  return (
    <div className="card">
      <Filters status={status} />
      {listing.kind === 'unavailable' ? (
        <p className={quiet}>Not available yet: the server does not have raise requests yet.</p>
      ) : listing.kind === 'forbidden' ? (
        <p className={quiet}>Only HR, the CEO and Finance can see raise requests.</p>
      ) : listing.kind === 'failed' ? (
        <p className={quiet}>
          Couldn&apos;t load the raise requests. <span className="block pt-1 text-xs">{listing.message}</span>
        </p>
      ) : listing.value.length === 0 ? (
        <p className={quiet}>
          {status ? 'No raise requests with this status.' : 'No raise requests yet. They are asked for on the Employment tab of a profile.'}{' '}
          {status && <Link href={raiseRequestsHref('')}>Show all</Link>}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-line">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Asked By</th>
                  <th scope="col">Reason</th>
                  <th scope="col" className="text-right">
                    Suggested Gross
                  </th>
                  <th scope="col">Prepared Raise</th>
                  <th scope="col">Status</th>
                  <th scope="col">Decision</th>
                  {hr && (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {listing.value.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="align-top">
                      <Link href={requestHref(r)} className="font-semibold">
                        {r.employee.fullNameEn}
                      </Link>
                      <div className="text-xs text-muted">
                        <span className="tabular-nums">{r.employee.employeeCode}</span> · asked {askedAt(r)}
                      </div>
                    </td>
                    <td className="min-w-40 align-top">
                      <Requester request={r} />
                    </td>
                    <td className="max-w-80 min-w-56 align-top whitespace-pre-line">{r.reason}</td>
                    <td className="text-right align-top whitespace-nowrap">
                      <SuggestedGross request={r} />
                    </td>
                    <td className="min-w-56 align-top">
                      <PreparedRaise request={r} />
                    </td>
                    <td className="align-top">
                      <RaiseRequestStatusBadge status={r.status} />
                    </td>
                    <td className="min-w-56 align-top">
                      <Progress request={r} />
                      {ceo && r.status === 'with_ceo' && (
                        <Link href="/approvals" className="mt-1 block text-sm font-semibold">
                          Decide in Approvals<span className="sr-only"> on the raise for {r.employee.fullNameEn}</span>
                        </Link>
                      )}
                    </td>
                    {hr && (
                      <td className="align-top">
                        <HrRequestActions request={r} user={user} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{requestsLabel(listing.value.length)}</p>
        </>
      )}
    </div>
  );
}

export default function RaiseRequestsPage({ searchParams }: PageProps<'/raise-requests'>) {
  return (
    <div className="max-w-7xl">
      <h1 className="text-2xl font-semibold">Raise Requests</h1>
      <p className="mt-1 text-muted">
        Raises asked for by employees for themselves, by their direct managers or by HR, each with a reason. HR declines a request or prepares the
        raise from it; the CEO then approves, returns or declines that raise on <Link href="/approvals">Approvals</Link>.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Requests searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
