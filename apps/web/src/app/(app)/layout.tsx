import type { Role } from '@trendlix/shared';
import { Suspense } from 'react';
import { Brand, BrandFallback } from '@/components/brand';
import { COMING_SOON } from '@/components/nav';
import { NavLinks, NavLinksFallback } from '@/components/nav-links';
import { UserMenu } from '@/components/user-menu';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import type { ChangeRequest, EmployeeProfile, EmployeeSummary, EndingSummary, SessionUser } from '@/lib/types';
import { decidesChangeRequests, followsEndings, getOrNull, PENDING_CHANGE_REQUESTS, PENDING_ENDINGS } from './approvals/data';
import { ReviewNowLink } from './employees/[id]/confirm/confirm-notices';
import { bannerMessage } from './employees/confirmation';

/** The sidebar links for the signed-in user's roles. */
async function MainNav() {
  // Like the user menu: an API outage must not take the page down, so it falls back to the links everyone sees.
  let roles: Role[] = [];
  try {
    roles = (await getCurrentUser()).roles;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  // Beside Approvals: for HR and the CEO, the endings waiting for the CEO; for HR and Admin, the employees' change
  // requests waiting for them. Each is left out when it can't be read.
  const [endings, changes] = await Promise.all([
    followsEndings({ roles }) ? getOrNull<EndingSummary[]>(PENDING_ENDINGS) : null,
    decidesChangeRequests({ roles }) ? getOrNull<ChangeRequest[]>(PENDING_CHANGE_REQUESTS) : null,
  ]);
  const waiting = (endings?.length ?? 0) + (changes?.length ?? 0);
  return <NavLinks roles={roles} counts={waiting ? { '/approvals': waiting } : undefined} />;
}

/**
 * The signed-in user's own profile: the employee whose work email is their sign-in email, as the API links them. Found
 * among the people they may see (GET /employees: just themself for an employee, plus their team for a manager), then
 * read; null when they have none, or when either can't be read.
 */
async function ownProfile(user: SessionUser): Promise<EmployeeProfile | null> {
  const email = user.email.toLowerCase();
  const own = (await getOrNull<EmployeeSummary[]>('/employees'))?.find((e) => e.workEmail?.toLowerCase() === email);
  return own ? getOrNull<EmployeeProfile>(`/employees/${own.id}`) : null;
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
  const own = await ownProfile(user);
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

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-sidebar px-4 py-4 md:w-60 md:shrink-0 md:py-6">
        <div className="mb-4 md:mb-8">
          <Suspense fallback={<BrandFallback dark />}>
            <Brand dark />
          </Suspense>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col">
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
  );
}
