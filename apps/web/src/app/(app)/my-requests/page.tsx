import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { formatDate, formatDateTime } from '@/lib/format';
import { hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeProfile } from '@/lib/types';
import { NoProfile } from '../dashboard/cards';
import { ChangeRequestStatusBadge, ChangesTable } from '../employees/[id]/change-request/request-parts';
import { employeeRaiseRequestsHref, Loading } from '../employees/ui';
import { loadTeam } from '../my-team/data';
import { loadOwnProfile } from '../own-profile';
import { loadEmployeeRaiseRequests } from '../raise-requests/data';
import { askedAt } from '../raise-requests/list';
import { PreparedRaise, Progress, RaiseRequestStatusBadge, Requester, SuggestedGross } from '../raise-requests/ui';
import {
  askedByManager,
  filterRequests,
  myRequests,
  myRequestsHref,
  readRequestFilters,
  REQUEST_KIND_LABELS,
  REQUEST_KINDS,
  REQUEST_STATE_LABELS,
  REQUEST_STATES,
  requestCounts,
  requestTitle,
  type MyRequest,
  type RequestFilters,
} from './requests';

// My Requests (owner, 17 October 2026: "my suggestion for the employee side bar is 1- Dashboard 2- My Profile 3- My
// Requests"): everything the employee asked for, newest first, filtered by kind and status in the address (so a link
// keeps them), each with its decisions as the API gives them to the employee; buttons to ask again; for a direct
// manager also the raises they asked for for their direct reports (no figure: the API sends a manager none). The
// changes to their details are their profile's: the one waiting for HR and the latest ten decided. Leave and attendance
// requests come later. Cancelling a change waiting for HR stays on the change request page.

export const metadata: Metadata = { title: 'My Requests · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';

function Chip({ href, label, count, active }: { href: string; label: string; count: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
    >
      {label}
      <span className={`tabular-nums ${active ? 'opacity-75' : 'text-muted'}`}>{count}</span>
    </Link>
  );
}

function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** A change to their details they asked HR for: what they asked for, their note, and HR's decision with its note. */
function DetailsCard({ item, employeeId }: { item: Extract<MyRequest, { kind: 'details' }>; employeeId: string }) {
  const r = item.request;
  return (
    <li className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{requestTitle(item)}</h3>
          <p className="text-sm text-muted">Sent {formatDateTime(r.requestedAt)}</p>
        </div>
        <ChangeRequestStatusBadge status={r.status} />
      </div>
      <ChangesTable changes={r.changes} fromLabel="Was" toLabel="Asked for" caption={`What you asked for on ${formatDate(r.requestedAt)}`} />
      {(r.note || r.decidedAt || r.decisionNote) && (
        <dl className="grid gap-3 text-sm">
          {r.note && (
            <Item label="Your note">
              <span className="whitespace-pre-line">{r.note}</span>
            </Item>
          )}
          {r.decidedAt && (
            <Item label={r.status === 'cancelled' ? 'Cancelled' : 'Decided by HR'}>
              {r.status !== 'cancelled' && r.decidedBy?.email && <>{r.decidedBy.email} · </>}
              {formatDateTime(r.decidedAt)}
            </Item>
          )}
          {r.decisionNote && (
            <Item label="HR's note">
              <span className="whitespace-pre-line">{r.decisionNote}</span>
            </Item>
          )}
        </dl>
      )}
      {item.open && (
        <Link href={`/employees/${employeeId}/change-request`} className="inline-block text-sm font-semibold">
          See or cancel this request
        </Link>
      )}
    </li>
  );
}

/** A raise they asked for (or, for a manager, asked for for a direct report): why, the raise prepared, where it stands. */
function RaiseCard({ item }: { item: Extract<MyRequest, { kind: 'raise' | 'team' }> }) {
  const r = item.request;
  return (
    <li className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{requestTitle(item)}</h3>
          <p className="text-sm text-muted">Asked {askedAt(r)}</p>
        </div>
        <RaiseRequestStatusBadge status={r.status} />
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Item label="Asked by">
          <Requester request={r} />
        </Item>
        {r.suggestedGross !== null && (
          <Item label="Suggested gross a month">
            <SuggestedGross request={r} />
          </Item>
        )}
        <Item label="Why" wide>
          <span className="whitespace-pre-line">{r.reason}</span>
        </Item>
        {r.raise && (
          <Item label="The raise">
            <PreparedRaise request={r} />
          </Item>
        )}
        <Item label="Where it stands">
          <Progress request={r} />
        </Item>
      </dl>
      <Link href={employeeRaiseRequestsHref(r.employee.id)} className="inline-block text-sm font-semibold">
        {item.kind === 'team' ? `Open ${r.employee.fullNameEn}'s raise requests` : 'Open on my profile'}
      </Link>
    </li>
  );
}

function Filters({ all, f, team }: { all: MyRequest[]; f: RequestFilters; team: boolean }) {
  const counts = requestCounts(all, f);
  const kinds = REQUEST_KINDS.filter((k) => k !== 'team' || team || f.kind === 'team');
  return (
    <div className="space-y-2">
      <nav aria-label="Filter by kind" className="flex flex-wrap gap-2">
        <Chip href={myRequestsHref({ ...f, kind: '' })} label="All" count={counts.kinds['']} active={!f.kind} />
        {kinds.map((k) => (
          <Chip key={k} href={myRequestsHref({ ...f, kind: k })} label={REQUEST_KIND_LABELS[k]} count={counts.kinds[k]} active={f.kind === k} />
        ))}
      </nav>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        <Chip href={myRequestsHref({ ...f, status: '' })} label="Any status" count={counts.states['']} active={!f.status} />
        {REQUEST_STATES.map((s) => (
          <Chip key={s} href={myRequestsHref({ ...f, status: s })} label={REQUEST_STATE_LABELS[s]} count={counts.states[s]} active={f.status === s} />
        ))}
      </nav>
    </div>
  );
}

function NewRequestButtons({ profile, canRequestRaise }: { profile: EmployeeProfile; canRequestRaise: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/employees/${profile.id}/change-request`} className="btn btn-secondary">
        Ask to change my details
      </Link>
      {canRequestRaise && (
        <Link href={employeeRaiseRequestsHref(profile.id)} className="btn btn-primary">
          Request a raise
        </Link>
      )}
    </div>
  );
}

async function Requests({ searchParams }: { searchParams: PageProps<'/my-requests'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const manager = hasRole(user, 'manager');
  const [raises, team] = await Promise.all([loadEmployeeRaiseRequests(profile.id), manager ? loadTeam(profile) : []]);
  const own = raises.kind === 'ok' ? raises.value : null;
  const forTeam = team.flatMap((m) => (m.raises.kind === 'ok' ? askedByManager(m.raises.value.requests, user.email) : []));
  const all = myRequests({ changes: profile.changeRequests ?? [], raises: own?.requests ?? [], team: forTeam });
  const f = readRequestFilters(query);
  const shown = filterRequests(all, f);
  const unloaded = raises.kind === 'failed' || team.some((m) => m.raises.kind === 'failed');

  return (
    <div className="space-y-5">
      <NewRequestButtons profile={profile} canRequestRaise={!!own?.canRequest} />
      {unloaded && <p className="text-sm text-muted">Some of your raise requests couldn&apos;t be loaded. Please try again in a moment.</p>}
      {all.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-muted">
          You haven&apos;t made any requests yet. Ask HR to change your details, or ask for a raise, with the buttons above.
        </div>
      ) : (
        <>
          <Filters all={all} f={f} team={forTeam.length > 0} />
          {shown.length === 0 ? (
            <div className="card px-6 py-10 text-center text-sm text-muted">
              No requests match these filters. <Link href={myRequestsHref({ kind: '', status: '' })}>Show all</Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {shown.map((item) =>
                item.kind === 'details' ? (
                  <DetailsCard key={`details:${item.id}`} item={item} employeeId={profile.id} />
                ) : (
                  <RaiseCard key={`${item.kind}:${item.id}`} item={item} />
                ),
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default function MyRequestsPage({ searchParams }: PageProps<'/my-requests'>) {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">My Requests</h1>
      <p className="mt-1 text-muted">What you have asked for, newest first, with each decision as it is made.</p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Requests searchParams={searchParams} />
        </Suspense>
      </div>
      <p className="mt-8 text-sm text-muted">Leave and attendance requests are coming soon.</p>
    </div>
  );
}
