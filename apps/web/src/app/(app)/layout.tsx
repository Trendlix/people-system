import { Suspense } from 'react';
import { COMING_SOON } from '@/components/nav';
import { NavLinks, NavLinksFallback } from '@/components/nav-links';
import { UserMenu } from '@/components/user-menu';

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-sidebar px-4 py-4 md:w-60 md:shrink-0 md:py-6">
        <div className="mb-4 flex items-center gap-3 md:mb-8">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent font-bold text-white">T</span>
          <div className="leading-tight">
            <p className="font-semibold text-white">TrendLIX</p>
            <p className="text-xs text-sidebar-text">People System</p>
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col">
          <Suspense fallback={<NavLinksFallback />}>
            <NavLinks />
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
