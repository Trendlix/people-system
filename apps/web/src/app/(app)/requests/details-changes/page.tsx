import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import type { ChangeRequest } from '@/lib/types';
import { getCurrentUser } from '@/lib/session';
import { decideListedChangeRequest } from '../../approvals/actions';
import { decidesChangeRequests } from '../../approvals/data';
import { DecisionForm } from '../../approvals/decision-form';
import { ChangeRequestCard } from '../../employees/[id]/change-request/request-parts';
import { Empty, Loading } from '../../organization/ui';
import { loadJson } from '../../payroll/load';
import { StaffOnly } from '../../staff-only';
import {
  changeRequestsPath,
  decisionView,
  detailsChangesHref,
  emptyText,
  fromLabel,
  readDone,
  readStatus,
  requestsLabel,
  STATUS_FILTERS,
  type StatusFilter,
} from './list';

// Details Changes, under Requests in the sidebar (owner, 17 October 2026: "A Requests heading", with Raise Requests and,
// later, Leave): every employee's request to change their details (owner's decision, 15 October 2026), newest first,
// filtered by status in the address, each with whose profile it is, what they asked to change and when, and the
// decision: who, when and why. HR and Admin (a Super Admin too) decide the ones waiting right here, as on Approvals,
// which stays the inbox of what waits for them. The API checks every request again.

export const metadata: Metadata = { title: 'Details Changes · People System' };

const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';

/** The status filter: one link per status, so the address keeps it. */
function Filters({ status }: { status: StatusFilter }) {
  return (
    <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
      {STATUS_FILTERS.map((o) => {
        const active = o.value === status;
        return (
          <Link
            key={o.value || 'all'}
            href={detailsChangesHref(o.value)}
            aria-current={active ? 'page' : undefined}
            className={`${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Who decided a request and when, and the note given with it; the form to decide it while it waits. */
function Decision({ request: r, status }: { request: ChangeRequest; status: StatusFilter }) {
  const d = decisionView(r);
  if (!d) {
    return (
      <DecisionForm
        action={decideListedChangeRequest.bind(null, r.id, status)}
        confirmApprove={`Approve the change to ${r.employee.fullNameEn}'s details? Their profile is updated with what they asked for.`}
        noteMax={1000}
      />
    );
  }
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-line-soft pt-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted">Decision</dt>
        <dd className="mt-0.5 font-medium">{d.title}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">When</dt>
        <dd className="mt-0.5">{d.at ?? <span className="text-muted">—</span>}</dd>
      </div>
      {d.note && (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted">{d.noteLabel}</dt>
          <dd className="mt-0.5 whitespace-pre-line">{d.note}</dd>
        </div>
      )}
    </dl>
  );
}

async function Requests({ searchParams }: { searchParams: PageProps<'/requests/details-changes'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!decidesChangeRequests(user)) return <Empty>Only HR and Admin can see the employees&apos; change requests.</Empty>;
  const status = readStatus(query);
  const done = readDone(query);
  const listing = await loadJson<ChangeRequest[]>(changeRequestsPath(status));

  return (
    <div className="space-y-4">
      {done && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {done}
        </p>
      )}
      <Filters status={status} />
      {listing.kind === 'forbidden' ? (
        <Empty>Only HR and Admin can see the employees&apos; change requests.</Empty>
      ) : listing.kind !== 'ok' ? (
        <Empty>
          Couldn&apos;t load the change requests.
          {listing.kind === 'failed' && <span className="block pt-1 text-xs">{listing.messages.join(' ')}</span>}
        </Empty>
      ) : listing.value.length === 0 ? (
        <Empty>
          {emptyText(status)} {status && <Link href={detailsChangesHref('')}>Show all</Link>}
        </Empty>
      ) : (
        <>
          <p className="text-sm text-muted">
            {requestsLabel(listing.value.length)}, newest first. Approving makes the change on the profile; a rejection needs a note saying why,
            which the employee sees.
          </p>
          <ul className="space-y-4">
            {listing.value.map((r) => (
              <ChangeRequestCard key={r.id} request={r} fromLabel={fromLabel(r.status)}>
                <Decision request={r} status={status} />
              </ChangeRequestCard>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function DetailsChangesPage({ searchParams }: PageProps<'/requests/details-changes'>) {
  return (
    <StaffOnly>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-semibold">Details Changes</h1>
        <p className="mt-1 text-muted">
          Employees&apos; requests to change their details, asked for when they check them on their profile. HR or an Admin approves a request,
          which makes the change, or rejects it with a note the employee sees. The ones waiting are on <Link href="/approvals">Approvals</Link>{' '}
          too.
        </p>
        <div className="mt-6">
          <Suspense fallback={<Loading />}>
            <Requests searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </StaffOnly>
  );
}
