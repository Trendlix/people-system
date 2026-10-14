import type { Role } from '@trendlix/shared';
import { Suspense } from 'react';
import { Brand, BrandFallback } from '@/components/brand';
import { COMING_SOON } from '@/components/nav';
import { NavLinks, NavLinksFallback } from '@/components/nav-links';
import { UserMenu } from '@/components/user-menu';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';

/** The sidebar links for the signed-in user's roles. */
async function MainNav() {
  // Like the user menu: an API outage must not take the page down, so it falls back to the links everyone sees.
  let roles: Role[] = [];
  try {
    roles = (await getCurrentUser()).roles;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  return <NavLinks roles={roles} />;
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
          <p className="px-3 text-xs font-semibold tracking-wide text-sidebar-text/70 uppercase">Coming next</p>
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
        <main className="flex-1 px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
