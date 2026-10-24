'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { activeSubItem, isActive, type NavItem } from './nav';
import {
  groupCount,
  groupKey,
  groupListId,
  GROUPS_STORAGE_KEY,
  isGroup,
  isGroupOpen,
  NOTHING_REMEMBERED,
  remember,
  type NavCounts,
  type NavGroup,
  type Remembered,
} from './nav-groups';

// a clear ring on what a keyboard is on, white on the dark sidebar, inside the link or button: the lists that open and
// close clip what is outside them
const focus = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white';
const base = `flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium no-underline ${focus}`;
// a sub-item: smaller, and indented under its item in the sidebar; in the row of links on a phone, after it, as tall as
// the others there (44px, for a finger)
const subBase = `flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap no-underline md:min-h-9 md:pl-7 ${focus}`;
const on = 'bg-sidebar-active text-white';
const off = 'text-sidebar-text hover:bg-white/5 hover:text-white';
// a heading holding the page: white, as the section it is in, its page highlighted under it
const holds = 'text-white hover:bg-white/5';

/** How many things wait behind a link, when there are any; at the end of the row in the sidebar unless said otherwise. */
function Count({ count, className = 'md:ml-auto' }: { count: number | undefined; className?: string }) {
  if (!count) return null;
  return (
    <span className={`rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white tabular-nums ${className}`}>
      {count}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

// ---------- the headings the user opened or closed since the page was loaded ----------
// Kept in this tab's memory only, so a sign-in or a refresh starts with every heading closed (owner, 24 October 2026:
// "on login and refresh make sure all items are collapsed"); moving between pages keeps them as the user left them. Read
// with useSyncExternalStore: the server and the page's first run have nothing opened, so nothing jumps.

const listeners = new Set<() => void>();
/** The user's choices since this page was loaded (a module of the page: a new load starts it again). */
let chosen: Remembered = NOTHING_REMEMBERED;
let oldStorageCleared = false;

function readRemembered(): Remembered {
  if (!oldStorageCleared) {
    oldStorageCleared = true;
    // earlier versions kept the opened headings in the browser and reopened them on every load
    try {
      window.localStorage.removeItem(GROUPS_STORAGE_KEY);
    } catch {
      // nothing to clear without the storage
    }
  }
  return chosen;
}

const nothingRemembered = () => NOTHING_REMEMBERED;

function saveRemembered(key: string, open: boolean) {
  chosen = remember(chosen, key, open);
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** A link without pages under it (Home, Organization, Approvals), with its count. */
function NavLink({ item, pathname, counts }: { item: NavItem; pathname: string; counts?: NavCounts }) {
  const active = isActive(item, pathname);
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={`${base} ${active ? on : off}`}>
      {item.label}
      <Count count={counts?.[item.href]} />
    </Link>
  );
}

/**
 * A heading with pages under it (owner, 20 October 2026: "make the side menu subs expandable - which means requests
 * with an arrow beside it to expand and collapse the side menues"): a button with an arrow, pointing right while its
 * pages are hidden and down while they show, turning as they open; Enter and Space work it, as any button. Its pages
 * slide open and shut (at once for those who ask for less motion); hidden, they are out of the keyboard's way and a
 * screen reader's. Closed, it shows their counts added up (Requests 3), so nothing waiting is hidden; open, each page
 * shows its own. The open state is on the button (aria-expanded), and the arrow, the count and the list follow it: the
 * script that opens the remembered headings changes that alone.
 */
function NavGroupLinks({
  item,
  pathname,
  open,
  onToggle,
  counts,
}: {
  item: NavGroup;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  counts?: NavCounts;
}) {
  const key = groupKey(item);
  const listId = groupListId(key);
  const active = isActive(item, pathname);
  // on a page of a sub-item, the sub-item is the one highlighted; its heading stays white, as the section it is in
  const current = active ? (activeSubItem(item, pathname)?.href ?? null) : null;
  return (
    <div className="flex shrink-0 gap-1 md:flex-col md:gap-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        data-nav-group={key}
        onClick={onToggle}
        className={`group peer ${base} shrink-0 cursor-pointer text-left whitespace-nowrap md:w-full ${active ? (current ? holds : on) : off}`}
      >
        <span className="md:mr-auto">{item.label}</span>
        <Count count={groupCount(item, counts)} className="group-aria-expanded:hidden" />
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4 shrink-0 opacity-70 transition-transform duration-200 ease-out group-aria-expanded:rotate-90 motion-reduce:transition-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </button>
      {/* in the sidebar its height slides between none and all of the list's; in the row of links on a phone it is
          left out until it opens */}
      <div className="invisible grid grid-rows-[0fr] transition-[grid-template-rows,visibility] duration-200 ease-out peer-aria-expanded:visible peer-aria-expanded:grid-rows-[1fr] motion-reduce:transition-none max-md:hidden max-md:peer-aria-expanded:grid">
        <div className="min-h-0 overflow-hidden">
          <ul id={listId} aria-label={item.label} className="flex gap-1 md:flex-col md:pt-1">
            {item.items.map((sub) => {
              const here = sub.href === current;
              return (
                <li key={sub.href}>
                  <Link href={sub.href} aria-current={here ? 'page' : undefined} className={`${subBase} ${here ? on : off}`}>
                    {sub.label}
                    <Count count={counts?.[sub.href]} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * `items`: the user's sidebar (navFor in nav.ts: an employee's own, or the items for HR's, Finance's, the CEO's and
 * Admins' roles). `counts`: how many things wait behind a link, by its href (e.g. endings waiting for the CEO, beside
 * Approvals; the raise requests waiting for HR, beside Raise Requests under Requests). A heading with pages under it
 * opens and closes them (NavGroupLinks): every heading starts closed when the page is loaded (after signing in, on a
 * refresh), the one holding the page too, which still shows as current; one the user opens stays open while they move
 * between pages (nav-groups.ts; owner, 24 October 2026).
 */
export function NavLinks({ items, counts }: { items: NavItem[]; counts?: NavCounts }) {
  const pathname = usePathname();
  const remembered = useSyncExternalStore(subscribe, readRemembered, nothingRemembered);
  return (
    <>
      {items.map((item) => {
        if (!isGroup(item)) return <NavLink key={item.href} item={item} pathname={pathname} counts={counts} />;
        const key = groupKey(item);
        const open = isGroupOpen(key, remembered);
        const toggle = () => saveRemembered(key, !open);
        return <NavGroupLinks key={`group:${key}`} item={item} pathname={pathname} open={open} onToggle={toggle} counts={counts} />;
      })}
    </>
  );
}

/**
 * Quiet rows in place of the links, shown until the user is known. Every link waits for them: an employee's sidebar
 * isn't everyone else's (owner, 17 October 2026: Dashboard, My Profile, My Requests; not the Organization tab), so none
 * flashes up for someone who doesn't get it.
 */
export function NavLinksFallback() {
  return (
    <>
      <span className="sr-only">Loading the menu…</span>
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden="true" className="flex min-h-11 shrink-0 items-center px-3">
          <span className="block h-2.5 w-24 rounded-full bg-white/10" />
        </span>
      ))}
    </>
  );
}
