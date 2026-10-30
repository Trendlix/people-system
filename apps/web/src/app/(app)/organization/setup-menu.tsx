import Link from 'next/link';
import { Suspense } from 'react';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { setupGroupsFor, setupPage, type SetupGroup, type SetupKey } from './setup-pages';
import { SetupPicker } from './setup-picker';

// Organization, the setup home (owner, 23 October 2026: "lets perform a regorganization of this menu. we can perform
// groupings to related items"; asked, "Side menu with headings"), in place of the row of tabs: the heading, then the
// setup pages in their groups (setup-pages.ts), on the left at desktop widths, each group's heading in small capitals
// over its pages and the current page marked; on a phone and a narrow window, a "Setup page" drop-down above the page.
// Rendered by each section's own layout with its key, so the current page is known on the server and shows at once
// (reading the address in the browser would flash an unselected state).

const INTRO =
  'How the company is set up, in six groups: the company itself, its structure, time and leave, pay and contracts, performance, and hiring and leaving. You see the pages your role keeps.';

const headingId = (group: SetupGroup) => `setup-group-${group.label.toLowerCase().replace(/[^a-z]+/g, '-')}`;

/**
 * The menu on the left at desktop widths (lg and up), the current page marked; in sight as the page scrolls, and
 * scrolling on its own when taller than the window (a Super Admin's 17 pages on a short screen).
 */
function SideMenu({ groups, active }: { groups: readonly SetupGroup[]; active: SetupKey }) {
  return (
    <nav aria-label="Organization setup" className="hidden lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.label}>
            <p id={headingId(g)} className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {g.label}
            </p>
            <ul aria-labelledby={headingId(g)} className="space-y-0.5">
              {g.pages.map((p) => (
                <li key={p.key}>
                  <Link
                    href={p.href}
                    aria-current={p.key === active ? 'page' : undefined}
                    className={`flex min-h-9 items-center rounded-lg px-3 py-1.5 text-sm leading-snug no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                      p.key === active ? 'bg-accent-soft font-semibold text-accent' : 'text-ink hover:bg-line-soft'
                    }`}
                  >
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/** Both ways in: the drop-down below lg, the side menu from lg. */
function Menus({ groups, active }: { groups: readonly SetupGroup[]; active: SetupKey }) {
  const current = groups.some((g) => g.pages.some((p) => p.key === active)) ? setupPage(active).href : null;
  return (
    <>
      <SetupPicker key={current ?? 'none'} groups={groups} current={current} />
      <SideMenu groups={groups} active={active} />
    </>
  );
}

/** The pages this user sees; who it is can't be read (the API is down): those everyone who had the tabs sees. */
async function UserMenus({ active }: { active: SetupKey }) {
  let groups: SetupGroup[];
  try {
    groups = setupGroupsFor(await getCurrentUser());
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    groups = setupGroupsFor(null);
  }
  return <Menus groups={groups} active={active} />;
}

/** A setup page: the heading, its menu and the page beside it (below it on a phone). */
export function SetupFrame({ active, children }: { active: SetupKey; children: React.ReactNode }) {
  return (
    <div className="max-w-7xl">
      <h1 className="page-title">Organization</h1>
      <p className="mt-1 max-w-3xl text-muted">{INTRO}</p>
      <div className="mt-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* who it is was read for the page already (StaffOnly), so this waits for nothing; meanwhile, the pages everyone has */}
        <Suspense fallback={<Menus groups={setupGroupsFor(null)} active={active} />}>
          <UserMenus active={active} />
        </Suspense>
        <div className="mt-6 min-w-0 lg:mt-0">{children}</div>
      </div>
    </div>
  );
}
