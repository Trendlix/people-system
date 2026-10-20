'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeTab, countText, tabLabel, type AppTab, type AppTabKey } from './tabs';

// The phone pages' tab bar (owner, 20 October 2026: the employee app; apps/mobile/README.md, Phase 1): fixed at the
// bottom, within the thumb's reach, each tab a large target with its icon and name, clear of the phone's home bar
// (safe-area insets), lower in landscape with the name beside the icon. The tab of the page is highlighted; To Approve
// says how many wait for the caller. Phase 5 (20 October 2026: accessibility): each tab at least 64 px tall (48 in
// landscape) across a fifth of the bar, named for a screen reader with its count ("To Approve, 3 waiting"), its focus
// ring inside it; the count's badge white on the accent blue (5.5:1), ringed off the icon.

const ICON = 'size-6 shrink-0 landscape:size-5';

const ICONS: Record<AppTabKey, React.ReactNode> = {
  home: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z" />
    </svg>
  ),
  requests: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3.5h7.5L19 8v12.5H7z" />
      <path d="M14 3.5V8.5h5M10 13h6M10 16.5h6" />
    </svg>
  ),
  attendance: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12.5" r="8" />
      <path d="M12 8v4.5l3 2" />
    </svg>
  ),
  payslips: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6.5 9.5v5M17.5 9.5v5" />
    </svg>
  ),
  approve: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.3 2.4 2.4 4.8-5" />
    </svg>
  ),
};

/** The tabs, the one of the page (`active`) highlighted; no hooks, so it can stand in while the user is read. */
export function TabList({ tabs, active, counts }: { tabs: readonly AppTab[]; active: AppTabKey | null; counts?: Partial<Record<AppTabKey, number>> }) {
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
    >
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((t) => {
          const on = t.key === active;
          const count = countText(counts?.[t.key]);
          return (
            <li key={t.key} className="min-w-0 flex-1">
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                aria-label={count ? tabLabel(t.label, counts?.[t.key]) : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] leading-tight font-semibold no-underline focus-visible:outline-offset-[-3px] landscape:min-h-12 landscape:flex-row landscape:gap-1.5 landscape:text-xs ${on ? 'text-accent' : 'text-muted hover:text-ink'}`}
              >
                <span className="relative">
                  {ICONS[t.key]}
                  {count && (
                    <span aria-hidden="true" className="absolute -top-1.5 -right-3 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] leading-5 font-semibold text-white tabular-nums ring-2 ring-card">
                      {count}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The tab bar, with the page's tab highlighted. */
export function TabBar({ tabs, counts }: { tabs: readonly AppTab[]; counts?: Partial<Record<AppTabKey, number>> }) {
  const pathname = usePathname();
  return <TabList tabs={tabs} active={activeTab(pathname)} counts={counts} />;
}
