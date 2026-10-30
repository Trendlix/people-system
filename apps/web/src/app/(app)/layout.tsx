import type { KpiCounts, Role } from '@trendlix/shared';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { decidesForTeam, DETAILS_CHANGES_PATH, LEAVE_PATH, MY_TEAM, navFor, RAISE_REQUESTS_PATH, REIMBURSEMENTS_PATH } from '@/components/nav';
import { NavLinks, NavLinksFallback } from '@/components/nav-links';
import { BellLink, NotificationBell } from '@/components/notification-bell';
import { CheckInReminder } from '@/components/check-in-reminder';
import { SessionWatch } from '@/components/session-watch';
import { ThemeSwitch } from '@/components/theme-switch';
import { UserMenu } from '@/components/user-menu';
import { DeveloperBanner } from '@/components/developer-banner';
import { ModeGate } from '@/components/mode-gate';
import { HoldGate } from '@/components/hold-gate';
import { ViewAsBanner } from '@/components/view-as-banner';
import { ApiError } from '@/lib/api';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { hasRole, isSelfService } from '@/lib/roles';
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
import { COMPENSATORY_COUNTS } from './attendance/compensatory/compensatory';
import { WFH_COUNTS } from './attendance/wfh/wfh';
import type { CompensatoryCounts } from '@/lib/compensatory-types';
import type { WfhCounts } from '@/lib/wfh-types';
import { OD_COUNTS } from './attendance/official-duty/od';
import type { OdCounts } from '@/lib/od-types';
import type { AccessCounts } from '@trendlix/shared';

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
  // The KPI scorecards waiting for the user (owner, 21 October 2026: "The KPI items waiting for someone are counted in
  // the sidebar and on Approvals"): their own to rate or sign beside My KPIs, their people's to score or sign beside
  // Team KPIs, HR's to calibrate (a C-level person's for the CEO) beside All KPIs; for those who see Approvals, the team's
  // and HR's in its count too, as it lists them.
  // The work from home requests waiting for the user (owner, 21 October 2026: "Manager, then HR"): beside Approvals for
  // those who see it (HR, the CEO, Admin), which lists them, and in My Team's for a manager or a lead.
  const wfhCounted = hasRole({ roles }, 'hr', 'ceo', 'admin') || manager;
  // the official duty requests waiting for the user the same way (owner, 23 October 2026: "Manager, then HR")
  const odCounted = wfhCounted;
  // the compensatory day requests waiting for the user the same way (owner, 26 October 2026: "Manager, then HR")
  const compensatoryCounted = wfhCounted;
  // beside Employees, for HR and Admin (a Super Admin too), the people whose access is on hold (owner, 23 October 2026:
  // "Access should be on hold with a 7 days grace period one time granted by the hr"): HR gives grace or renews them
  const accessCounted = hasRole({ roles }, 'hr', 'admin');
  const [endings, pendingChanges, raises, requests, claims, leave, corrections, homes, kpis, wfh, access, od, compensatory] = await Promise.all([
    followsEndings({ roles }) ? getOrNull<EndingSummary[]>(PENDING_ENDINGS, bg) : null,
    readsChangeRequests({ roles }) ? getOrNull<ChangeRequest[]>(PENDING_CHANGE_REQUESTS, bg) : null,
    followsRaises({ roles }) ? getOrNull<PendingRaise[]>(PENDING_RAISES, bg) : null,
    countsRaiseRequests({ roles }) ? getOrNull<RaiseRequest[]>(WITH_HR_REQUESTS, bg) : null,
    canSeeReimbursements({ roles }) || manager ? getOrNull<ReimbursementCounts>(CLAIM_COUNTS, bg) : null,
    canSeeLeaveRequests({ roles }) || manager ? getOrNull<LeaveCounts>(LEAVE_COUNTS, bg) : null,
    seesCorrections({ roles }) || manager ? getOrNull<CorrectionCounts>(CORRECTION_COUNTS, bg) : null,
    seesHomes({ roles }) ? getOrNull<HomeLocationCounts>(HOME_COUNTS, bg) : null,
    user ? getOrNull<KpiCounts>(KPI_API.counts, bg) : null,
    user && wfhCounted ? getOrNull<WfhCounts>(WFH_COUNTS, bg) : null,
    user && accessCounted ? getOrNull<AccessCounts>('/employees/access/counts', bg) : null,
    user && odCounted ? getOrNull<OdCounts>(OD_COUNTS, bg) : null,
    user && compensatoryCounted ? getOrNull<CompensatoryCounts>(COMPENSATORY_COUNTS, bg) : null,
  ]);
  const changes = pendingChanges && waitingForYou({ roles }, pendingChanges);
  const raiseRequests = requests ? waitingForYouCount({ roles }, requests) : 0;
  const kpiApprovals = hasRole({ roles }, 'hr', 'ceo', 'admin') ? (kpis?.team ?? 0) + (kpis?.hr ?? 0) : 0;
  const wfhApprovals = hasRole({ roles }, 'hr', 'ceo', 'admin') ? (wfh?.waiting ?? 0) : 0;
  const odApprovals = hasRole({ roles }, 'hr', 'ceo', 'admin') ? (od?.waiting ?? 0) : 0;
  const compensatoryApprovals = hasRole({ roles }, 'hr', 'ceo', 'admin') ? (compensatory?.waiting ?? 0) : 0;
  const waiting = (endings?.length ?? 0) + (changes?.length ?? 0) + (raises?.length ?? 0) + (homes?.waiting ?? 0) + kpiApprovals + wfhApprovals + odApprovals + compensatoryApprovals;
  const counts: Record<string, number> = {};
  if (waiting) counts['/approvals'] = waiting;
  if (kpis?.self) counts[KPI_PATHS.mine] = kpis.self;
  if (kpis?.team) counts[KPI_PATHS.team] = kpis.team;
  if (kpis?.hr) counts[KPI_PATHS.all] = kpis.hr;
  if (raiseRequests) counts[RAISE_REQUESTS_PATH] = raiseRequests;
  if (access?.hold) counts['/employees'] = access.hold;
  if (changes?.length) counts[DETAILS_CHANGES_PATH] = changes.length;
  if (self) {
    const team = (claims?.waiting ?? 0) + (leave?.waiting ?? 0) + (corrections?.waiting ?? 0) + (manager ? (wfh?.waiting ?? 0) + (od?.waiting ?? 0) + (compensatory?.waiting ?? 0) : 0);
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

/**
 * At the foot of the side menu, the design's "Profile completeness" (30 October 2026): how complete one's own employee
 * profile is, with a bar and the way to it, while something is still missing; nothing for an account without a profile
 * or a complete one. The same read as the banner above (loadOwnProfile is read once per page).
 */
async function ProfileCompleteness() {
  let user: SessionUser;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  const own = await loadOwnProfile(user);
  const percent = own?.completeness.percent;
  if (!own || percent === undefined || percent >= 100) return null;
  const missing = own.completeness.missing.length;
  return (
    <div className="mt-auto hidden rounded-[15px] border border-sidebar-line bg-white/[0.03] p-4 md:block">
      <p className="flex items-center justify-between text-[11px] text-sidebar-ink">
        <span>Profile completeness</span>
        <span className="tabular-nums">{percent}%</span>
      </p>
      <div aria-hidden="true" className="mt-2.5 h-1 rounded-full bg-white/15">
        <div className="h-full rounded-full bg-sidebar-ink" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-3 text-[11px] leading-snug text-sidebar-text">
        {missing === 1 ? '1 detail is' : `${missing} details are`} still missing from your profile.
      </p>
      <Link href={`/employees/${own.id}`} className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-sidebar-ink no-underline hover:underline">
        Review profile
        <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.6} />
      </Link>
    </div>
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
      {/* a developer who is also an employee and hasn't chosen how to use the system: the choice page (22 October 2026) */}
      <Suspense fallback={null}>
        <ModeGate />
        {/* someone whose access is on hold: the Hold page, check-in and check-out only (owner, 23 October 2026) */}
        <HoldGate />
        <ViewAsBanner />
        <DeveloperBanner />
      </Suspense>
      <Suspense fallback={null}>
        <SessionWatch />
      </Suspense>
      {/* "You haven't checked in yet" (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a
          leave every 10 minutes. like a popup"), never while viewing as someone */}
      <Suspense fallback={null}>
        <CheckInReminder surface="site" />
      </Suspense>
      <div className="flex flex-1 flex-col md:flex-row">
        {/* the owner's design (30 October 2026): the near-black side menu, its own scroll on a computer so the page's
            stays the page's */}
        <aside className="bg-sidebar px-4 py-4 md:sticky md:top-0 md:flex md:h-screen md:w-[252px] md:shrink-0 md:flex-col md:border-r md:border-sidebar-line md:py-6">
          <div className="mb-4 px-2 md:mb-8">
            <Suspense fallback={<BrandFallback dark />}>
              <Brand dark />
            </Suspense>
          </div>
          <p className="eyebrow mb-2 hidden px-3 text-sidebar-quiet md:block">Workspace</p>
          <nav aria-label="Main" className="relative flex gap-1 overflow-x-auto md:-mx-1 md:min-h-0 md:flex-col md:overflow-x-visible md:overflow-y-auto md:px-1 md:pb-4">
            <Suspense fallback={<NavLinksFallback />}>
              <MainNav />
            </Suspense>
          </nav>
          {/* no Coming Next any more: Attendance, its last item, is a heading of its own (owner, 19 October 2026: "the
              attendance is not active in the side menu") */}
          <Suspense fallback={null}>
            <ProfileCompleteness />
          </Suspense>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-[72px] items-center justify-end gap-2 border-b border-line px-4 sm:px-8">
            {/* on a phone-width screen, the way to the phone pages (owner, 20 October 2026: "what if we tried to build a
                mobile app for the employees? to enable them to check in and out, and apply for their requests") */}
            <Link href="/app" className="mr-auto shrink-0 text-sm font-semibold sm:hidden">
              Open the app view
            </Link>
            {/* light or dark (the owner's design, 30 October 2026) */}
            <ThemeSwitch />
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
          {/* the design's page: a wide column with room around it */}
          <main className="w-full max-w-[1500px] flex-1 self-center px-4 py-6 sm:px-8 lg:px-[34px] lg:py-[34px]">{children}</main>
        </div>
      </div>
    </div>
  );
}
