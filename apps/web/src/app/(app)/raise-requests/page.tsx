import Link from 'next/link';
import { Suspense } from 'react';
import { Select } from '@/components/select';
import { loadLawRates } from '@/lib/law-rates';
import type { RaiseRequest } from '@/lib/raise-types';
import { getCurrentUser } from '@/lib/session';
import { employeeRaiseRequestsHref } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { loadRaiseRequests } from './data';
import {
  askedAt,
  canSeeRaiseRequests,
  effectiveFromText,
  handlesRaiseRequests,
  justSent,
  newRaiseRequestHref,
  raiseRequestAnchor,
  raiseRequestsHref,
  readStatus,
  requestsLabel,
  STATUS_FILTERS,
  type StatusFilter,
} from './list';
import { FoldedRequestLog, HrRequestActions, PreparedRaise, Progress, RaiseRequestStatusBadge, RequestReason, RequestSent, Requester, Suggestion } from './ui';

// Raise Requests (owner's decisions, 16 October 2026: "a place to request raise by employee, or his manager or the HR,
// with a reason and to be going through an approval cycle"; reworked 17 October 2026): every request, newest first,
// filtered by status by a GET form so the address can be shared, each with the reason from the list, the comment, the
// raise suggested and its log of every step. HR decides a request with HR, with a comment: approves it as suggested or
// with another raise (the raise is prepared and goes to the CEO on Approvals) or rejects it; the CEO's decision on that
// raise is the request's. HR and the CEO see the page, and Finance may view it; the API checks every request again and
// sends the amounts only to them. Requests are asked for here since 17 October 2026 ("i think raising a request should
// be moved from the Employee tab to the raise requests tab"): New raise request opens the form (/raise-requests/new),
// for HR anyone employed now, for the CEO and Finance themselves; once sent, it is listed first here. Each request says
// the month it is asked from ("Effective from"), and HR's decision starts with it.

const quiet = 'border-t border-line px-4 py-10 text-center text-sm text-muted';

/** The person, linked to their Employment tab's Salary sub-tab, where the request and its raise are. */
const requestHref = (r: RaiseRequest) => employeeRaiseRequestsHref(r.employee.id);

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
  const ceo = user.roles.includes('ceo');
  const hr = user.roles.includes('hr');
  // the years' rates set by law, for the figures of HR's other raise
  const [listing, rates] = await Promise.all([loadRaiseRequests(status), hr ? loadLawRates() : []]);

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
          {status ? 'No raise requests with this status.' : 'No raise requests yet. Ask for one with New raise request.'}{' '}
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
                  <th scope="col">Effective From</th>
                  <th scope="col" className="text-right">
                    Suggested Raise
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
                  <tr key={r.id} id={raiseRequestAnchor(r.id)} className="scroll-mt-6 align-top target:bg-accent-soft">
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
                    <td className="max-w-80 min-w-56 align-top">
                      <RequestReason request={r} />
                    </td>
                    <td className={`align-top whitespace-nowrap ${r.effectiveFrom ? 'tabular-nums' : 'text-muted'}`}>{effectiveFromText(r)}</td>
                    <td className="text-right align-top whitespace-nowrap">
                      <Suggestion request={r} />
                    </td>
                    <td className="min-w-56 align-top">
                      <PreparedRaise request={r} />
                    </td>
                    <td className="align-top">
                      <RaiseRequestStatusBadge status={r.status} />
                    </td>
                    <td className="min-w-64 align-top">
                      <Progress request={r} />
                      <FoldedRequestLog request={r} />
                      {ceo && r.status === 'with_ceo' && (
                        <Link href="/approvals" className="mt-1 block text-sm font-semibold">
                          Decide in Approvals<span className="sr-only"> on the raise for {r.employee.fullNameEn}</span>
                        </Link>
                      )}
                    </td>
                    {hr && (
                      <td className="align-top">
                        <HrRequestActions request={r} user={user} rates={rates} />
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

/**
 * New raise request, for those who may ask for one (HR for anyone employed now; the CEO and Finance for themselves: the
 * API checks it), and the line saying one was just sent (?sent=1).
 */
async function Asking({ searchParams }: { searchParams: PageProps<'/raise-requests'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const asks = canSeeRaiseRequests(user) && (handlesRaiseRequests(user) || !!user.employeeId);
  const sent = justSent(query);
  if (!asks && !sent) return null;
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">{sent && <RequestSent />}</div>
      {asks && (
        <Link href={newRaiseRequestHref()} className="btn btn-primary">
          New raise request
        </Link>
      )}
    </div>
  );
}

export default function RaiseRequestsPage({ searchParams }: PageProps<'/raise-requests'>) {
  return (
    <div className="max-w-7xl">
      <h1 className="text-2xl font-semibold">Raise Requests</h1>
      <p className="mt-1 text-muted">
        Raises asked for by employees for themselves, by their direct managers or by HR, each with a reason, a comment and the raise suggested.
        HR approves a request, as suggested or with another raise, or rejects it; the CEO then decides the raise on{' '}
        <Link href="/approvals">Approvals</Link>. Every step is logged on the request.
      </p>
      <div className="mt-6">
        <Suspense fallback={null}>
          <Asking searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={<Loading />}>
          <Requests searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
