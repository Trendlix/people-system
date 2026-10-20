import type { Role } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { decidesForTeam, DETAILS_CHANGES_PATH, LEAVE_PATH, MY_TEAM, navFor, RAISE_REQUESTS_PATH, REIMBURSEMENTS_PATH } from '@/components/nav';
import { NavLinks, NavLinksFallback } from '@/components/nav-links';
import { BellLink, NotificationBell } from '@/components/notification-bell';
import { SessionWatch } from '@/components/session-watch';
import { UserMenu } from '@/components/user-menu';
import { ViewAsBanner } from '@/components/view-as-banner';
import { ApiError } from '@/lib/api';
import { isSelfService } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import type { CorrectionCounts } from '@/lib/correction-types';
import type { HomeLocationCounts } from '@/lib/home-location-types';
import type { ChangeRequest, EndingSummary, LeaveCounts, ReimbursementCounts, SessionUser } from '@/lib/types';
import { followsEndings, getOrNull, PENDING_CHANGE_REQUESTS, PENDING_ENDINGS } from './approvals/data';
import { followsRaises, PENDING_RAISES } from './approvals/raises';
import { ReviewNowLink } from './employees/[id]/confirm/confirm-notices';
import { bannerMessage } from './employees/confirmation';
import { loadOwnProfile } from './own-profile';
import { countsRaiseRequests, waitingForYouCount, WITH_HR_REQUESTS } from './raise-requests/list';
import { canSeeLeaveRequests, LEAVE_COUNTS } from './leave/list';
import { canSeeReimbursements, CLAIM_COUNTS } from './reimbursements/list';
import { CORRECTION_COUNTS, CORRECTIONS_PATH, seesCorrections } from './attendance/corrections/corrections';
import { HOME_COUNTS, seesHomes } from './home-locations/home-locations';
import { readsChangeRequests, waitingForYou } from './requests/details-changes/list';

/**
 * The sidebar links for the signed-in user: an employee's or a manager's own (Dashboard, My Profile, My Requests, and
 * My Team for a manager: owner's decisions, 17 October 2026), else the links for their roles (navFor).
 */
async function MainNav() {
  // Like the user menu: an API outage must not take the page down, so it falls back to the link everyone has (Home).
  let user: SessionUser | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const roles: Role[] = user?.roles ?? [];
  // Beside Approvals: for HR and the CEO, the endings and the pay raises waiting for the CEO; for HR and Admin (a Super
  // Admin too), the employees' change requests waiting for them. Under Requests: beside Raise Requests, for HR, the
  // requests waiting for HR (owner's decisions, 16 October 2026); beside Details Changes, for HR and Admin, the change
  // requests waiting (the same read as Approvals'); beside Reimbursements, for HR, Finance and the CEO, and beside My
  // Team, for a direct manager on their own side, the claims waiting for them (18 October 2026); beside Leave Requests,
  // for HR and the CEO, the leave requests waiting for them, and those waiting for a direct manager added to My Team's
  // (18 October 2026). A department's head or a team's lead, who decides the claims and leave of its people without a
  // direct manager, gets My Team's as a direct manager does (19 October 2026). Each is left out when it can't be read.
  // A C-level person's requests (owner, 19 October 2026: "make C level Employees details not visible to HR"): the CEO
  // takes their HR (and Finance) stages, so the CEO's counts have them: beside Raise Requests, the C-level people's
  // requests at HR's step; beside Details Changes and Approvals, their change requests, which the CEO decides; beside
  // Reimbursements and Leave Requests, what the API counts as waiting for the CEO. Each count is what the user decides.
  // The leave count (`waiting`) has the permission requests in it (owner, 19 October 2026: permission "In the system,
  // like leave"), beside Leave Requests and in My Team's, as they are decided the same way. The attendance corrections
  // waiting (owner, 19 October 2026: "Attendance corrections with approval"): beside Attendance → Corrections for HR and
  // the CEO, in My Team's for a manager or a lead.
  // The counts are background requests (owner, 20 October 2026: HR, Admin and Super Admin signed out after 15 minutes
  // without activity): the web reads them by itself, so they don't count as activity; the page's own requests do.
  const self = isSelfService({ roles });
  const manager = self && decidesForTeam({ roles, leads: user?.leads });
  const bg = { background: true };
  // Beside Approvals too: the home locations at the user's step (owner, 20 October 2026: "then approved by the HR and
  // CEO"), for HR, the CEO and the Super Admin.
  const [endings, pendingChanges, raises, requests, claims, leave, corrections, homes] = await Promise.all([
    followsEndings({ roles }) ? getOrNull<EndingSummary[]>(PENDING_ENDINGS, bg) : null,
    readsChangeRequests({ roles }) ? getOrNull<ChangeRequest[]>(PENDING_CHANGE_REQUESTS, bg) : null,
    followsRaises({ roles }) ? getOrNull<PendingRaise[]>(PENDING_RAISES, bg) : null,
    countsRaiseRequests({ roles }) ? getOrNull<RaiseRequest[]>(WITH_HR_REQUESTS, bg) : null,
    canSeeReimbursements({ roles }) || manager ? getOrNull<ReimbursementCounts>(CLAIM_COUNTS, bg) : null,
    canSeeLeaveRequests({ roles }) || manager ? getOrNull<LeaveCounts>(LEAVE_COUNTS, bg) : null,
    seesCorrections({ roles }) || manager ? getOrNull<CorrectionCounts>(CORRECTION_COUNTS, bg) : null,
    seesHomes({ roles }) ? getOrNull<HomeLocationCounts>(HOME_COUNTS, bg) : null,
  ]);
  const changes = pendingChanges && waitingForYou({ roles }, pendingChanges);
  const raiseRequests = requests ? waitingForYouCount({ roles }, requests) : 0;
  const waiting = (endings?.length ?? 0) + (changes?.length ?? 0) + (raises?.length ?? 0) + (homes?.waiting ?? 0);
  const counts: Record<string, number> = {};
  if (waiting) counts['/approvals'] = waiting;
  if (raiseRequests) counts[RAISE_REQUESTS_PATH] = raiseRequests;
  if (changes?.length) counts[DETAILS_CHANGES_PATH] = changes.length;
  if (self) {
    const team = (claims?.waiting ?? 0) + (leave?.waiting ?? 0) + (corrections?.waiting ?? 0);
    if (team) counts[MY_TEAM] = team;
  } else {
    if (claims?.waiting) counts[REIMBURSEMENTS_PATH] = claims.waiting;
    if (leave?.waiting) counts[LEAVE_PATH] = leave.waiting;
    if (corrections?.waiting) counts[CORRECTIONS_PATH] = corrections.waiting;
  }
  return <NavLinks items={navFor(user)} counts={Object.keys(counts).length ? counts : undefined} />;
}

/**
 * On every page, for an employee whose details aren't confirmed, or changed since they confirmed them (owner's decision,
 * 15 October 2026): what to do, and Review now. It can't be dismissed; it goes once they confirm.
 */
async function ConfirmBanner() {
  let user: SessionUser;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  const own = await loadOwnProfile(user);
  const message = own && bannerMessage(own.confirmation);
  if (!own || !message) return null;
  return (
    <section aria-label="Confirm your details" className="border-b border-warn/20 bg-warn-soft px-4 py-3 sm:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm font-medium text-warn">{message}</p>
        <ReviewNowLink href={`/employees/${own.id}/confirm`} />
      </div>
    </section>
  );
}

/** The browser tab icon: the company's thumbnail when there is one. */
export function generateMetadata(): Promise<Metadata> {
  return brandMetadata();
}

export default function AppLayout({ children }: LayoutProps<'/'>) {
  // The view-as banner above everything, on every page, while a Super Admin views as someone (owner's decision,
  // 17 October 2026); it stays in sight as the page scrolls. The idle warning for HR, Admin and Super Admin (20 October
  // 2026: signed out after 15 minutes without activity), a minute before.
  return (
    <div className="flex min-h-screen flex-col">
      <Suspense fallback={null}>
        <ViewAsBanner />
      </Suspense>
      <Suspense fallback={null}>
        <SessionWatch />
      </Suspense>
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="bg-sidebar px-4 py-4 md:w-60 md:shrink-0 md:py-6">
          <div className="mb-4 md:mb-8">
            <Suspense fallback={<BrandFallback dark />}>
              <Brand dark />
            </Suspense>
          </div>
          <nav aria-label="Main" className="relative flex gap-1 overflow-x-auto md:flex-col">
            <Suspense fallback={<NavLinksFallback />}>
              <MainNav />
            </Suspense>
          </nav>
          {/* no Coming Next any more: Attendance, its last item, is a heading of its own (owner, 19 October 2026: "the
              attendance is not active in the side menu") */}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 items-center justify-end gap-3 border-b border-line bg-card px-4 sm:px-8">
            {/* on a phone-width screen, the way to the phone pages (owner, 20 October 2026: "what if we tried to build a
                mobile app for the employees? to enable them to check in and out, and apply for their requests") */}
            <Link href="/app" className="mr-auto shrink-0 text-sm font-semibold sm:hidden">
              Open the app view
            </Link>
            {/* the bell, with how many notifications are unread (owner, 20 October 2026: "Push notifications: yes") */}
            <Suspense fallback={<BellLink surface="site" unread={null} />}>
              <NotificationBell surface="site" />
            </Suspense>
            <Suspense fallback={<span className="text-sm text-muted">Loading…</span>}>
              <UserMenu />
            </Suspense>
          </header>
          <Suspense fallback={null}>
            <ConfirmBanner />
          </Suspense>
          <main className="flex-1 px-4 py-6 sm:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
