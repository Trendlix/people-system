'use client';

import {
  BriefcaseBusiness,
  Building,
  CalendarDays,
  CircleCheck,
  Clock,
  FileText,
  Handshake,
  Inbox,
  LayoutGrid,
  MessageCircle,
  Network,
  Package,
  ScrollText,
  TrendingUp,
  User,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
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

// The owner's design (Figma, 30 October 2026): the near-black side menu, its items in grey with a line icon, the page's
// item a light pill; the same on the light and the dark look.

// a clear ring on what a keyboard is on, grey, which shows on the dark menu and on the light pill, inside the link or
// button: the lists that open and close clip what is outside them
const focus = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-text';
const base = `flex min-h-11 items-center gap-3 rounded-[11px] px-3 text-[13px] font-normal no-underline transition-colors ${focus}`;
// a sub-item: indented under its item's words; on a phone as tall as the others (44px, for a finger). The menu is the
// same list top to bottom on a phone, opened by its button (components/phone-menu.tsx, 30 October 2026)
const subBase = `flex min-h-11 shrink-0 items-center gap-2 rounded-[11px] py-1 pr-3 pl-[2.6rem] text-[13px] font-normal no-underline transition-colors md:min-h-9 ${focus}`;
const on = 'bg-sidebar-active text-sidebar-on-active';
const off = 'text-sidebar-text hover:bg-white/5 hover:text-sidebar-ink';
// a heading holding the page: bright, as the section it is in, its page highlighted under it
const holds = 'text-sidebar-ink hover:bg-white/5';

/** Each top item's line icon (the design's: a grid for the Dashboard, a person for My Profile, …), by its words. */
const ICONS: Record<string, LucideIcon> = {
  Home: LayoutGrid,
  Dashboard: LayoutGrid,
  'My Profile': User,
  'My Requests': FileText,
  'My Attendance': CalendarDays,
  'My Team': Users,
  KPIs: TrendingUp,
  Assets: Package,
  Recruitment: BriefcaseBusiness,
  Clients: Handshake,
  Organization: Building,
  People: Users,
  Payroll: Wallet,
  Requests: Inbox,
  Attendance: Clock,
  Approvals: CircleCheck,
  Users: UserCog,
  'Audit Log': ScrollText,
  'WhatsApp Messages': MessageCircle,
};

function ItemIcon({ label }: { label: string }) {
  const Icon = ICONS[label] ?? Network;
  return <Icon aria-hidden="true" className="size-[17px] shrink-0" strokeWidth={1.6} />;
}

/** How many things wait behind a link, when there are any; at the end of the row in the sidebar unless said otherwise. */
function Count({ count, className = 'ml-auto' }: { count: number | undefined; className?: string }) {
  if (!count) return null;
  return (
    <span className={`min-w-5 rounded-full bg-sidebar-count px-1.5 py-0.5 text-center text-[11px] leading-4 font-medium text-sidebar-on-active tabular-nums ${className}`}>
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
      <ItemIcon label={item.label} />
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
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        data-nav-group={key}
        onClick={onToggle}
        className={`group peer ${base} w-full cursor-pointer text-left ${active ? (current ? holds : on) : off}`}
      >
        <ItemIcon label={item.label} />
        <span className="mr-auto">{item.label}</span>
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
      {/* its height slides between none and all of the list's */}
      <div className="invisible grid grid-rows-[0fr] transition-[grid-template-rows,visibility] duration-200 ease-out peer-aria-expanded:visible peer-aria-expanded:grid-rows-[1fr] motion-reduce:transition-none">
        <div className="min-h-0 overflow-hidden">
          <ul id={listId} aria-label={item.label} className="flex flex-col gap-1 pt-1">
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
