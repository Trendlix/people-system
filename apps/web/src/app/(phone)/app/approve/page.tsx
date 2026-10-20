import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import { getCurrentUser } from '@/lib/session';
import type { ChangeRequest, EndingSummary } from '@/lib/types';
import { decidesEndings, getOrNull, PENDING_CHANGE_REQUESTS, PENDING_ENDINGS } from '../../../(app)/approvals/data';
import { decidesRaises, PENDING_RAISES } from '../../../(app)/approvals/raises';
import { loadWaitingCorrections } from '../../../(app)/attendance/corrections/data';
import { loadWaitingHomes } from '../../../(app)/home-locations/data';
import { seesHomes } from '../../../(app)/home-locations/home-locations';
import { loadWaitingLeave, loadWaitingPermissions } from '../../../(app)/leave/data';
import { loadRaiseRequests } from '../../../(app)/raise-requests/data';
import { ceoDoneMessage, countsRaiseRequests, waitsForYou } from '../../../(app)/raise-requests/list';
import { loadWaitingClaims } from '../../../(app)/reimbursements/data';
import { readsChangeRequests, waitingForYou } from '../../../(app)/requests/details-changes/list';
import { decidesSomething } from '../tabs';
import { DoneLine, PageTitle, PhoneLoading, RowLink, RowList } from '../ui';
import { waitingSections, waitingTotal } from './waiting';

// To Approve on the phone pages (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? …";
// first version: "managers and team leads approve from the phone"): what waits for the caller, each opening its page
// with Approve / Reject and a comment, the site's own decision forms. Leave and permission, claims and corrections as
// My Team (a direct manager, a team's lead, a department's head) and HR's lists read them, waiting for the caller (the
// API answers for them alone: a C-level person's HR stage to the CEO, as on the site); the raise requests at HR's step
// for HR (a C-level person's for the CEO); the raises with the CEO for the CEO. Endings and details changes are decided
// on the site's Approvals: said here, with the way there, when any wait. Home locations (owner, 20 October 2026: "then
// approved by the HR and CEO") at the caller's step, for HR, the CEO and the Super Admin.

export const metadata: Metadata = { title: 'To Approve · TrendLIX People' };

type Loaded<T> = { kind: 'ok'; value: T } | { kind: string };
const listOf = <T,>(loaded: Loaded<T[]>): T[] | null => (loaded.kind === 'ok' ? (loaded as { value: T[] }).value : loaded.kind === 'failed' ? null : []);

/** The endings and details changes waiting for the caller, decided on the site. */
async function OnTheSite() {
  const user = await getCurrentUser();
  const [endings, changes] = await Promise.all([
    decidesEndings(user) ? getOrNull<EndingSummary[]>(PENDING_ENDINGS) : null,
    readsChangeRequests(user) ? getOrNull<ChangeRequest[]>(PENDING_CHANGE_REQUESTS) : null,
  ]);
  const ending = endings?.length ?? 0;
  const change = changes ? waitingForYou(user, changes).length : 0;
  if (!ending && !change) return null;
  const parts = [ending && `${ending} ${ending === 1 ? 'ending' : 'endings'} of employment`, change && `${change} ${change === 1 ? 'change' : 'changes'} of details`].filter(Boolean);
  return (
    <p className="rounded-lg bg-white px-4 py-3 text-sm text-muted">
      Also waiting for you on the full site: {parts.join(' and ')}.{' '}
      <Link href="/approvals" className="font-semibold">
        Open Approvals
      </Link>
    </p>
  );
}

async function Waiting({ searchParams }: { searchParams: PageProps<'/app/approve'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const done = ceoDoneMessage(query);
  if (!decidesSomething(user)) {
    return <div className="card px-4 py-8 text-center text-sm text-muted">Nothing here is yours to decide: requests wait here for those who decide them.</div>;
  }
  const [leave, permissions, claims, corrections, withHr, payRaises, homes] = await Promise.all([
    loadWaitingLeave(),
    loadWaitingPermissions(),
    loadWaitingClaims(),
    loadWaitingCorrections(),
    countsRaiseRequests(user) ? loadRaiseRequests('with_hr') : null,
    decidesRaises(user) ? getOrNull<PendingRaise[]>(PENDING_RAISES) : undefined,
    seesHomes(user) ? loadWaitingHomes() : null,
  ]);
  const sections = waitingSections({
    leave: listOf(leave),
    permissions: listOf(permissions),
    claims: listOf(claims),
    corrections: listOf(corrections),
    raiseRequests: withHr === null ? undefined : withHr.kind === 'ok' ? withHr.value.filter((r: RaiseRequest) => waitsForYou(user, r)) : withHr.kind === 'failed' ? null : [],
    payRaises,
    homes: homes === null ? undefined : listOf(homes),
  });
  const total = waitingTotal(sections);
  return (
    <div className="space-y-4">
      {done && <DoneLine text={done} />}
      {sections.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-muted">Nothing is waiting for you. You&apos;re all caught up.</div>
      ) : (
        <>
          <p className="text-sm text-muted">
            {total} {total === 1 ? 'request waits' : 'requests wait'} for you.
          </p>
          {sections.map((s) => (
            <section key={s.key} aria-labelledby={`waiting-${s.key}`} className="card">
              <h2 id={`waiting-${s.key}`} className="px-4 pt-4 font-semibold">
                {s.title} <span className="font-normal text-muted tabular-nums">· {s.rows.length}</span>
              </h2>
              {s.failed ? (
                <p className="px-4 py-4 text-sm text-muted">These couldn&apos;t be loaded. Please try again in a moment.</p>
              ) : (
                <div className="mt-2">
                  <RowList label={s.title}>
                    {s.rows.map((r) => (
                      <RowLink key={r.key} href={r.href} title={r.name} line={<span className="tabular-nums">{r.line}</span>} aside={<span className="badge">Decide</span>} />
                    ))}
                  </RowList>
                </div>
              )}
            </section>
          ))}
        </>
      )}
      <Suspense fallback={null}>
        <OnTheSite />
      </Suspense>
    </div>
  );
}

export default function PhoneApprovePage({ searchParams }: PageProps<'/app/approve'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="To Approve">What waits for your decision: approve it, or reject it with a comment.</PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Waiting searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
