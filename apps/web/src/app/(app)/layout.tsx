import type { Role } from '@trendlix/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { COMING_SOON, navFor } from '@/components/nav';
import { NavLinks, NavLinksFallback } from '@/components/nav-links';
import { UserMenu } from '@/components/user-menu';
import { ViewAsBanner } from '@/components/view-as-banner';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import type { ChangeRequest, EndingSummary, SessionUser } from '@/lib/types';
import { decidesChangeRequests, followsEndings, getOrNull, PENDING_CHANGE_REQUESTS, PENDING_ENDINGS } from './approvals/data';
import { followsRaises, PENDING_RAISES } from './approvals/raises';
import { ReviewNowLink } from './employees/[id]/confirm/confirm-notices';
import { bannerMessage } from './employees/confirmation';
import { loadOwnProfile } from './own-profile';
import { handlesRaiseRequests, WITH_HR_REQUESTS } from './raise-requests/list';

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
  // Admin too), the employees' change requests waiting for them. Beside Raise Requests, for HR, the requests waiting for
  // HR (owner's decisions, 16 October 2026). Each is left out when it can't be read.
  const [endings, changes, raises, requests] = await Promise.all([
    followsEndings({ roles }) ? getOrNull<EndingSummary[]>(PENDING_ENDINGS) : null,
    decidesChangeRequests({ roles }) ? getOrNull<ChangeRequest[]>(PENDING_CHANGE_REQUESTS) : null,
    followsRaises({ roles }) ? getOrNull<PendingRaise[]>(PENDING_RAISES) : null,
    handlesRaiseRequests({ roles }) ? getOrNull<RaiseRequest[]>(WITH_HR_REQUESTS) : null,
  ]);
  const waiting = (endings?.length ?? 0) + (changes?.length ?? 0) + (raises?.length ?? 0);
  const counts: Record<string, number> = {};
  if (waiting) counts['/approvals'] = waiting;
  if (requests?.length) counts['/raise-requests'] = requests.length;
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
  // 17 October 2026); it stays in sight as the page scrolls.
  return (
    <div className="flex min-h-screen flex-col">
      <Suspense fallback={null}>
        <ViewAsBanner />
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
          <div className="mt-8 hidden md:block">
            <p className="px-3 text-xs font-semibold tracking-wide text-sidebar-text/70 uppercase">Coming Next</p>
            <ul className="mt-2">
              {COMING_SOON.map((label) => (
                <li key={label} className="px-3 py-1.5 text-sm text-sidebar-text/60">
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 items-center justify-end border-b border-line bg-card px-4 sm:px-8">
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
