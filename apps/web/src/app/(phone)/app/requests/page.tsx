import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { APP_PATHS, APP_REQUEST_KINDS, appRequestsHref } from '@/lib/surface';
import { NoProfile } from '../../../(app)/dashboard/cards';
import { loadMyCorrections } from '../../../(app)/attendance/corrections/data';
import { loadMyLeave, loadMyPermissions } from '../../../(app)/leave/data';
import { LeaveStatusBadge } from '../../../(app)/leave/ui';
import { loadOwnProfile } from '../../../(app)/own-profile';
import { loadEmployeeRaiseRequests } from '../../../(app)/raise-requests/data';
import { justSent } from '../../../(app)/raise-requests/list';
import { RaiseRequestStatusBadge, RequestSent } from '../../../(app)/raise-requests/ui';
import { loadMyClaims } from '../../../(app)/reimbursements/data';
import { ClaimStatusBadge } from '../../../(app)/reimbursements/ui';
import { Chip, PageTitle, PhoneLoading, Quiet, RowLink, RowList } from '../ui';
import {
  APP_REQUEST_KIND_LABELS,
  appRequestCounts,
  appRequestHref,
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
// on the site. Changes to their details stay on the site's profile.

export const metadata: Metadata = { title: 'My Requests · TrendLIX People' };

function StatusBadge({ row }: { row: AppRequestRow }) {
  if (row.kind === 'reimbursement') return <ClaimStatusBadge status={row.request.status} confidential={row.request.confidential} />;
  if (row.kind === 'raise') return <RaiseRequestStatusBadge status={row.request.status} confidential={row.request.confidential} />;
  return <LeaveStatusBadge status={row.request.status} confidential={row.request.confidential} />;
}

async function Requests({ searchParams }: { searchParams: PageProps<'/app/requests'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const [leave, permissions, claims, corrections, raises] = await Promise.all([
    loadMyLeave(),
    loadMyPermissions(),
    loadMyClaims(),
    loadMyCorrections(),
    loadEmployeeRaiseRequests(profile.id),
  ]);
  const rows = appRequestRows({
    leave: leave.kind === 'ok' ? leave.value : undefined,
    permissions: permissions.kind === 'ok' ? permissions.value : undefined,
    claims: claims.kind === 'ok' ? claims.value : undefined,
    corrections: corrections.kind === 'ok' ? corrections.value : undefined,
    raises: raises.kind === 'ok' ? raises.value.requests : undefined,
  });
  const failed = [leave, permissions, claims, corrections, raises].some((l) => l.kind === 'failed');
  const f = readAppRequestFilters(query);
  const shown = filterAppRequests(rows, f);
  const counts = appRequestCounts(rows, f);

  return (
    <div className="space-y-4">
      {justSent(query) && <RequestSent />}
      <Link href={APP_PATHS.newRequest} className="btn btn-primary min-h-12 w-full">
        New request
      </Link>
      {failed && <Quiet>Some of your requests couldn&apos;t be loaded. Please try again in a moment.</Quiet>}
      <nav aria-label="Filter by kind" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip href={appRequestsHref('', f.status)} label="All" count={counts['']} active={!f.kind} />
        {APP_REQUEST_KINDS.map((k) => (
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
