import Link from 'next/link';
import { Suspense } from 'react';
import { actionFor, ASSETS_NAV, ASSETS_TABS, tabsFor, type NavAction, type NavSubItem, type NavTab } from '@/components/nav';
import { ApiError } from '@/lib/api';
import { ASSET_PATHS, CUSTODY_PATHS } from '@/lib/asset-paths';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { loadDrafts } from './data';
import { Loading } from './ui';

// The Assets pages shown as tabs (owner, 24 October 2026, on the 14 pages under Assets: "i thing we need to arragne the
// assets menu"; asked, "7 entries, the rest as tabs"): All Assets (All, Needs values, Drafts from Claude, and the Add
// asset button), Custody (Records, Holdings), Counts & Labels (Counts, Label sheets) and Setup (Rooms, Settings, Connect
// Claude). Each tab is a page at its own address, for whoever saw it in the menu before (components/nav.ts ASSETS_NAV):
// this draws its section's heading, the tabs the user sees with the page's own marked (the page says which, so it is
// known on the server and nothing flashes), and the page under them; with one tab alone, no row of tabs.

/** A page shown as a tab: its address. */
type AssetsTabHref = (typeof ASSETS_TABS)[keyof typeof ASSETS_TABS]['href'];

type Tabbed = NavSubItem & { tabs: NavTab[] };

/** Each section as wide as its widest page, so the heading's button and the tabs stay put from tab to tab. */
const WIDTHS: Record<string, string> = {
  [ASSET_PATHS.list]: 'max-w-7xl',
  [CUSTODY_PATHS.list]: 'max-w-7xl',
  [ASSET_PATHS.counts]: 'max-w-5xl',
  [ASSET_PATHS.rooms]: 'max-w-4xl',
};

/** The section a tab is in, as the menu defines it (every tab, whoever sees it). */
function sectionOf(tab: AssetsTabHref): Tabbed {
  const section = ASSETS_NAV.items?.find((sub): sub is Tabbed => !!sub.tabs?.some((t) => t.href === tab));
  if (!section) throw new Error(`No Assets section has the tab ${tab}`);
  return section;
}

/**
 * The section's heading, and its button at the top right for those it is for (Add asset); as tall with the button as
 * without it, so nothing moves once it shows.
 */
function Heading({ section, action }: { section: Tabbed; action?: NavAction | null }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${section.action ? 'min-h-11' : ''}`}>
      <h1 className="page-title">{section.label}</h1>
      {action && (
        <Link href={action.href} className="btn btn-primary">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** How many drafts from Claude wait to be confirmed, on their tab (what the register's link to them showed until now). */
async function DraftsWaiting() {
  const loaded = await loadDrafts();
  const open = loaded.kind === 'ok' ? loaded.value.length : 0;
  if (!open) return null;
  return (
    <span className="badge bg-accent-soft text-accent tabular-nums">
      {open}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

const tabClass = (on: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-semibold whitespace-nowrap no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
    on ? 'border-accent text-ink hover:text-ink' : 'border-transparent text-muted hover:text-ink'
  }`;

/**
 * The row of tabs, in the profile's tab style (employees/[id]/profile-tabs.tsx): links to their pages, the current one
 * underlined; scrolling sideways on a phone when they don't fit, the page itself never.
 */
function Tabs({ label, tabs, current }: { label: string; tabs: NavTab[]; current: AssetsTabHref }) {
  return (
    <nav aria-label={label} className="mt-4 flex gap-6 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined} className={tabClass(t.href === current)}>
          {t.label}
          {t.href === ASSET_PATHS.drafts && (
            <Suspense fallback={null}>
              <DraftsWaiting />
            </Suspense>
          )}
        </Link>
      ))}
    </nav>
  );
}

/** The heading, the tabs and the button this user sees; who it is can't be read (the API is down): neither. */
async function Framed({ section, tab, children }: { section: Tabbed; tab: AssetsTabHref; children: React.ReactNode }) {
  let user: SessionUser | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const tabs = user ? tabsFor(user, section) : [];
  const action = user ? actionFor(user, section) : null;
  const row = tabs.length > 1;
  return (
    <>
      <Heading section={section} action={action} />
      {row && <Tabs label={section.label} tabs={tabs} current={tab} />}
      <div className={row ? 'mt-4' : 'mt-1'}>{children}</div>
    </>
  );
}

/**
 * A page shown as a tab (`tab`, its address): its section's heading, the tabs and the page (`children`, its words and
 * what it shows) under them.
 */
export function AssetsFrame({ tab, children }: { tab: AssetsTabHref; children: React.ReactNode }) {
  const section = sectionOf(tab);
  return (
    <div className={WIDTHS[section.href]}>
      {/* who it is was read for the sidebar already, so this waits for little; meanwhile, the heading */}
      <Suspense
        fallback={
          <>
            <Heading section={section} />
            <div className="mt-6">
              <Loading />
            </div>
          </>
        }
      >
        <Framed section={section} tab={tab}>
          {children}
        </Framed>
      </Suspense>
    </div>
  );
}
