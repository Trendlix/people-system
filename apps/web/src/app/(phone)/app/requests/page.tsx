import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { seesRaiseRequests } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { APP_PATHS, appRequestsHref } from '@/lib/surface';
import { NoProfile } from '../../../(app)/dashboard/cards';
import { todayInCairo } from '../../../(app)/employees/ui';
import { coveringCountText, coveringToCome } from '../../../(app)/my-requests/covering';
import { loadMyCovering } from '../../../(app)/my-requests/covering-data';
import { CoveringList } from '../../../(app)/my-requests/covering-list';
import { loadMyCorrections } from '../../../(app)/attendance/corrections/data';
import { loadMyWfh } from '../../../(app)/attendance/wfh/data';
import { loadMyOd } from '../../../(app)/attendance/official-duty/data';
import { loadMyHomes } from '../../../(app)/home-locations/data';
import { HomeStatusBadge } from '../../../(app)/home-locations/ui';
import { loadMyLeave, loadMyPermissions } from '../../../(app)/leave/data';
import { LeaveStatusBadge } from '../../../(app)/leave/ui';
import { loadOwnProfile } from '../../../(app)/own-profile';
import { loadEmployeeRaiseRequests } from '../../../(app)/raise-requests/data';
import { justSent } from '../../../(app)/raise-requests/list';
import { RaiseRequestStatusBadge, RequestSent } from '../../../(app)/raise-requests/ui';
import { loadMyClaims } from '../../../(app)/reimbursements/data';
import { ClaimStatusBadge } from '../../../(app)/reimbursements/ui';
import { MyKpiCard } from '../kpi-card';
import { Chip, PageTitle, PhoneLoading, Quiet, RowLink, RowList } from '../ui';
import {
  APP_REQUEST_KIND_LABELS,
  appRequestCounts,
  appRequestHref,
  appRequestKindsFor,
  appRequestProgress,
  appRequestRows,
  appRequestTitle,
  appRequestWhen,
  filterAppRequests,
  readAppRequestFilters,
  type AppRequestRow,
} from './rows';

// The phone pages' My Requests (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? to
// enable them to check in and out, and apply for their requests"): every request of theirs, newest first, whatever its
// kind (leave, permission, reimbursement claims, attendance corrections, raise requests), each with its status and
// where it stands, opening its page with every step; chips to show one kind or the open ones (in the address, so a
// link keeps them); and New request. The lists are the API's for the employee (GET /me/…), as My Requests reads them
// on the site. Changes to their details stay on the site's profile. Raise requests (owner, 20 October 2026: "raises not
// to be visible to employee level for now", then "Hide from managers too") only for someone who sees them
// (seesRaiseRequests): not read, listed or offered as a chip otherwise. Their home location requests too (owner, 20
// October 2026: "allow other users to request to add their home locations when working from home"). Their own KPI
// scorecard when it waits for them to rate themself or to sign (owner's brief, 21 October 2026: "a card on Home and
// Requests for the employee's self-rating and sign-off"), above the list. Their work from home days (owner, 21 October
// 2026: "think about how should we handle the working from home in out erp"): asked, recorded by HR or imported. The
// colleagues' leave they cover (owner, 25 October 2026: "Required over 2 days"), above the list when there is some: a
// cover's notification opens here on the phone.

export const metadata: Metadata = { title: 'My Requests · Trendlix People' };

/** I'm Covering (25 October 2026): the colleagues' leave they were named to cover, current or to come; never its type. */
async function Covering() {
  const loaded = await loadMyCovering();
  if (loaded.kind !== 'ok') return null;
  const today = todayInCairo();
  const list = coveringToCome(loaded.value, today);
  if (!list.length) return null;
  return (
    <section aria-labelledby="covering-heading" className="card space-y-2 p-4">
      <h2 id="covering-heading" className="font-semibold">
        I’m Covering
      </h2>
      <p className="text-xs text-muted">Colleagues who named you to cover their work while they are away: {coveringCountText(list.length)}.</p>
      <CoveringList list={list} today={today} compact />
    </section>
  );
}

function StatusBadge({ row }: { row: AppRequestRow }) {
  if (row.kind === 'reimbursement') return <ClaimStatusBadge status={row.request.status} confidential={row.request.confidential} />;
  if (row.kind === 'raise') return <RaiseRequestStatusBadge status={row.request.status} confidential={row.request.confidential} />;
  if (row.kind === 'home') return <HomeStatusBadge status={row.request.status} confidential={row.request.confidential} />;
  return <LeaveStatusBadge status={row.request.status} confidential={row.request.confidential} />;
}

async function Requests({ searchParams }: { searchParams: PageProps<'/app/requests'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const seesRaises = seesRaiseRequests(user);
  const [leave, permissions, claims, corrections, raises, homes, wfh, od] = await Promise.all([
    loadMyLeave(),
    loadMyPermissions(),
    loadMyClaims(),
    loadMyCorrections(),
    seesRaises ? loadEmployeeRaiseRequests(profile.id) : null,
    loadMyHomes(),
    loadMyWfh(),
    // official duty (23 October 2026)
    loadMyOd(),
  ]);
  const rows = appRequestRows({
    leave: leave.kind === 'ok' ? leave.value : undefined,
    permissions: permissions.kind === 'ok' ? permissions.value : undefined,
    claims: claims.kind === 'ok' ? claims.value : undefined,
    corrections: corrections.kind === 'ok' ? corrections.value : undefined,
    raises: raises?.kind === 'ok' ? raises.value.requests : undefined,
    homes: homes.kind === 'ok' ? homes.value : undefined,
    wfh: wfh.kind === 'ok' ? wfh.value : undefined,
    od: od.kind === 'ok' ? od.value : undefined,
  });
  const failed = [leave, permissions, claims, corrections, raises, homes, wfh, od].some((l) => l?.kind === 'failed');
  const kinds = appRequestKindsFor(seesRaises);
  const f = readAppRequestFilters(query, kinds);
  const shown = filterAppRequests(rows, f);
  const counts = appRequestCounts(rows, f);

  return (
    <div className="space-y-4">
      {seesRaises && justSent(query) && <RequestSent />}
      <Link href={APP_PATHS.newRequest} className="btn btn-primary min-h-12 w-full">
        New request
      </Link>
      <Suspense fallback={null}>
        <MyKpiCard user={user} />
      </Suspense>
      <Suspense fallback={null}>
        <Covering />
      </Suspense>
      {failed && <Quiet>Some of your requests couldn&apos;t be loaded. Please try again in a moment.</Quiet>}
      <nav aria-label="Filter by kind" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip href={appRequestsHref('', f.status)} label="All" count={counts['']} active={!f.kind} />
        {kinds.map((k) => (
          <Chip key={k} href={appRequestsHref(k, f.status)} label={APP_REQUEST_KIND_LABELS[k]} count={counts[k]} active={f.kind === k} />
        ))}
      </nav>
      <nav aria-label="Filter by status" className="flex gap-2">
        <Chip href={appRequestsHref(f.kind, '')} label="Any status" active={!f.status} />
        <Chip href={appRequestsHref(f.kind, 'open')} label="Being decided" active={f.status === 'open'} />
      </nav>
      {rows.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-muted">You haven&apos;t asked for anything yet. Ask with New request.</div>
      ) : shown.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-muted">
          No requests match these filters. <Link href={APP_PATHS.requests}>Show all</Link>
        </div>
      ) : (
        <div className="card">
          <RowList label="Your requests">
            {shown.map((row) => (
              <RowLink
                key={`${row.kind}:${row.id}`}
                href={appRequestHref(row)}
                title={appRequestTitle(row)}
                line={
                  <>
                    <span className="block tabular-nums">{appRequestWhen(row)}</span>
                    <span className="block">{appRequestProgress(row)}</span>
                  </>
                }
                aside={<StatusBadge row={row} />}
              />
            ))}
          </RowList>
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            {shown.length} {shown.length === 1 ? 'request' : 'requests'}, newest first.
          </p>
        </div>
      )}
    </div>
  );
}

export default function PhoneRequestsPage({ searchParams }: PageProps<'/app/requests'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="My Requests">What you have asked for, newest first, with each decision as it is made.</PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Requests searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
