'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { activeSubItem, isActive, type NavItem } from './nav';
import {
  groupCount,
  groupHolding,
  groupKey,
  groupListId,
  GROUPS_STORAGE_KEY,
  isGroup,
  isGroupOpen,
  NOTHING_REMEMBERED,
  OPEN_REMEMBERED_SCRIPT,
  parseRemembered,
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

// ---------- the headings the user opened or closed, kept in the browser (localStorage) ----------
// Read with useSyncExternalStore: the server and the page's first run in the browser have nothing remembered (the
// heading holding the page open, the others closed), then the browser's. A script in the page's HTML opens the
// remembered ones as it arrives (OPEN_REMEMBERED_SCRIPT), so nothing jumps open once the menu runs. Every read and write
// is in try/catch: without the storage (a private window, storage blocked or full) the menu works, for the page.

const listeners = new Set<() => void>();
/** The user's choices in this tab once they make one: kept even when the browser refuses to store them. */
let chosen: Remembered | null = null;
/** What the storage held when last read, and what it says (the same object while it holds the same). */
let stored: { raw: string | null; remembered: Remembered } = { raw: null, remembered: NOTHING_REMEMBERED };

function readRemembered(): Remembered {
  if (chosen) return chosen;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(GROUPS_STORAGE_KEY);
  } catch {
    return NOTHING_REMEMBERED;
  }
  if (raw !== stored.raw) stored = { raw, remembered: parseRemembered(raw) };
  return stored.remembered;
}

const nothingRemembered = () => NOTHING_REMEMBERED;

function saveRemembered(key: string, open: boolean) {
  chosen = remember(readRemembered(), key, open);
  try {
    window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(chosen));
  } catch {
    // kept for this tab alone
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // opened or closed in another tab of this browser
  const onStorage = (event: StorageEvent) => {
    if (event.key !== GROUPS_STORAGE_KEY && event.key !== null) return;
    chosen = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * A script the browser runs as the server's HTML arrives (Next.js's guide, preventing a flash before hydration); in the
 * browser's own renders a data block, never run.
 */
function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
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
        // the script may have opened it before the menu ran (OPEN_REMEMBERED_SCRIPT), as the menu then does
        suppressHydrationWarning
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
 * opens and closes them (NavGroupLinks): the one holding the page is open whenever a page opens, even one the user
 * closed on the page before; the others are as the user left them in this browser, closed until then (nav-groups.ts).
 */
export function NavLinks({ items, counts }: { items: NavItem[]; counts?: NavCounts }) {
  const pathname = usePathname();
  const remembered = useSyncExternalStore(subscribe, readRemembered, nothingRemembered);
  // the heading holding the page, closed by the user on it; on the next page it is open again (state reset as a value
  // changes: https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  const [closed, setClosed] = useState<{ path: string; key: string } | null>(null);
  if (closed && closed.path !== pathname) setClosed(null);
  const holding = groupHolding(items, pathname);
  const closedHere = closed?.path === pathname ? closed.key : null;
  return (
    <>
      {items.map((item) => {
        if (!isGroup(item)) return <NavLink key={item.href} item={item} pathname={pathname} counts={counts} />;
        const key = groupKey(item);
        const open = isGroupOpen(key, { holding, remembered, closedHere });
        const toggle = () => {
          saveRemembered(key, !open);
          if (key === holding) setClosed(open ? { path: pathname, key } : null);
        };
        return <NavGroupLinks key={`group:${key}`} item={item} pathname={pathname} open={open} onToggle={toggle} counts={counts} />;
      })}
      <InlineScript html={OPEN_REMEMBERED_SCRIPT} />
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
