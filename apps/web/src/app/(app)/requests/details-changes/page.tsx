import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { decidesChangeOfDetails } from '@/lib/confidential';
import type { ChangeRequest, PhotoRequest, SessionUser } from '@/lib/types';
import { getCurrentUser } from '@/lib/session';
import { decideListedChangeRequest } from '../../approvals/actions';
import { getOrNull } from '../../approvals/data';
import { DecisionForm } from '../../approvals/decision-form';
import { ChangeRequestCard } from '../../employees/[id]/change-request/request-parts';
import { decideListedPhotoRequest } from '../../employees/photo-request-actions';
import { PhotoDecision, PhotoRequestCard } from '../../employees/photo-request-card';
import { photoRequestsPath } from '../../employees/photo-requests';
import { Empty, Loading } from '../../organization/ui';
import { loadJson } from '../../payroll/load';
import { StaffOnly } from '../../staff-only';
import {
  changeDeciders,
  changeRequestsPath,
  decisionView,
  detailsChangesHref,
  emptyText,
  fromLabel,
  readDone,
  readsChangeRequests,
  readStatus,
  requestsLabel,
  STATUS_FILTERS,
  type StatusFilter,
} from './list';

// Details Changes, under Requests in the sidebar (owner, 17 October 2026: "A Requests heading", with Raise Requests and,
// later, Leave): every employee's request to change their details (owner's decision, 15 October 2026), newest first,
// filtered by status in the address, each with whose profile it is, what they asked to change and when, and the
// decision: who, when and why. HR and Admin (a Super Admin too) decide the ones waiting right here, as on Approvals,
// which stays the inbox of what waits for them. The API checks every request again. A C-level person's request (owner,
// 19 October 2026: "make C level Employees details not visible to HR") the CEO decides, or a Super Admin: the CEO reads
// the page for them (the API sends the CEO only C-level people's), each marked C-level and "Waiting for the CEO" while it
// waits; HR without Super Admin doesn't get them. The decide buttons show only to who decides each
// (decidesChangeOfDetails).

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
            className={`${chip} ${active ? 'border-ink bg-ink text-on-accent hover:text-on-accent' : 'border-line bg-card text-ink hover:bg-canvas hover:text-ink'}`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Who decided a request and when, and the note given with it; the form to decide it while it waits, for who decides it
 * (a C-level person's: the CEO or a Super Admin), else who it waits for.
 */
function Decision({ request: r, status, user }: { request: ChangeRequest; status: StatusFilter; user: SessionUser }) {
  const d = decisionView(r);
  if (!d && !decidesChangeOfDetails(user, r.confidential)) {
    return <p className="mt-4 border-t border-line-soft pt-4 text-sm text-muted">Waiting for {changeDeciders(r.confidential)} to decide it.</p>;
  }
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

/**
 * The new photos employees sent (owner, 31 October 2026: "allow them to upload a new photo as a request and approved from
 * the HR"), with the same status as the change requests above: decided here as on Approvals by who decides each (a
 * C-level person's: the CEO or a Super Admin), else who decided it and why. Read quietly: an API from before it shows
 * nothing.
 */
async function Photos({ status, user }: { status: StatusFilter; user: SessionUser }) {
  const photos = await getOrNull<PhotoRequest[]>(photoRequestsPath(status));
  if (photos === null) return null;
  return (
    <section className="space-y-4 pt-4" aria-labelledby="new-photos">
      <h2 id="new-photos" className="text-lg font-semibold">
        New Photos
      </h2>
      {photos.length === 0 ? (
        <Empty>{status === 'pending' ? 'No new photos are waiting.' : status ? 'No new photos with this status.' : 'No new photos yet. Employees send them from their profile.'}</Empty>
      ) : (
        <ul className="space-y-4">
          {photos.map((r) => (
            <PhotoRequestCard key={r.id} request={r}>
              {r.status !== 'pending' ? (
                <PhotoDecision request={r} />
              ) : decidesChangeOfDetails(user, r.confidential) ? (
                <DecisionForm
                  action={decideListedPhotoRequest.bind(null, r.id, status)}
                  confirmApprove={`Use this photo for ${r.employee.fullNameEn}? It becomes the personal photo in their employee file.`}
                  noteMax={1000}
                  noteHint="optional"
                />
              ) : (
                <p className="mt-4 border-t border-line-soft pt-4 text-sm text-muted">Waiting for {changeDeciders(r.confidential)} to decide it.</p>
              )}
            </PhotoRequestCard>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Requests({ searchParams }: { searchParams: PageProps<'/requests/details-changes'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!readsChangeRequests(user)) return <Empty>Only HR, Admin and the CEO can see the employees&apos; change requests.</Empty>;
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
        <Empty>Only HR, Admin and the CEO can see the employees&apos; change requests.</Empty>
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
                <Decision request={r} status={status} user={user} />
              </ChangeRequestCard>
            ))}
          </ul>
        </>
      )}
      {listing.kind === 'ok' && (
        <Suspense fallback={<Loading />}>
          <Photos status={status} user={user} />
        </Suspense>
      )}
    </div>
  );
}

export default function DetailsChangesPage({ searchParams }: PageProps<'/requests/details-changes'>) {
  return (
    <StaffOnly>
      <div className="max-w-5xl">
        <h1 className="page-title">Details Changes</h1>
        <p className="mt-1 text-muted">
          Employees&apos; requests to change their details, asked for when they check them on their profile, and the new photos they send.
          HR or an Admin approves a request, which makes the change, or rejects it with a note the employee sees; a C-level person&apos;s, the
          CEO or a Super Admin. The ones waiting are on <Link href="/approvals">Approvals</Link> too.
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
