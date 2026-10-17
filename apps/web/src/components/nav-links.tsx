'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';
import { activeSubItem, isActive, type NavItem } from './nav';

const base = 'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium no-underline';
// a sub-item: smaller, and indented under its item in the sidebar; in the row of links on a phone, after it
const subBase = 'flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap no-underline md:pl-7';
const on = 'bg-sidebar-active text-white';
const off = 'text-sidebar-text hover:bg-white/5 hover:text-white';

type Counts = Partial<Record<string, number>>;

/** How many things wait behind a link, when there are any. */
function Count({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white tabular-nums md:ml-auto">
      {count}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

/** An item's sub-items, the one for this page highlighted (`current`; null: none), each with its count. */
function SubLinks({ item, current, counts }: { item: NavItem; current: string | null; counts?: Counts }) {
  return item.items?.map((sub) => {
    const active = sub.href === current;
    return (
      <Link key={`sub:${sub.href}`} href={sub.href} aria-current={active ? 'page' : undefined} className={`${subBase} ${active ? on : off}`}>
        {sub.label}
        <Count count={counts?.[sub.href]} />
      </Link>
    );
  });
}

/**
 * `items`: the user's sidebar (navFor in nav.ts: an employee's own, or the items for HR's, Finance's, the CEO's and
 * Admins' roles). `counts`: how many things wait behind a link, by its href (e.g. endings waiting for the CEO, beside
 * Approvals; the raise requests waiting for HR, beside Raise Requests under Requests). An item with sub-items shows
 * theirs, not one of its own: it links to its first sub-item, whose count would show twice.
 */
export function NavLinks({ items, counts }: { items: NavItem[]; counts?: Counts }) {
  const pathname = usePathname();
  return items.map((item) => {
    const active = isActive(item, pathname);
    // on a page of a sub-item, the sub-item is the one highlighted; its item stays white, as the section it is in
    const current = active ? (activeSubItem(item, pathname)?.href ?? null) : null;
    return (
      <Fragment key={item.href}>
        <Link
          href={item.href}
          aria-current={active && !current ? 'page' : undefined}
          className={`${base} ${active ? (current ? 'text-white' : on) : off}`}
        >
          {item.label}
          {!item.items && <Count count={counts?.[item.href]} />}
        </Link>
        <SubLinks item={item} current={current} counts={counts} />
      </Fragment>
    );
  });
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
