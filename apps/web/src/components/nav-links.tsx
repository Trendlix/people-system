'use client';

import type { Role } from '@trendlix/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';
import { hasRole } from '@/lib/roles';
import { activeSubItem, NAV, type NavItem } from './nav';

const base = 'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium no-underline';
// a sub-item: smaller, and indented under its item in the sidebar; in the row of links on a phone, after it
const subBase = 'flex min-h-9 shrink-0 items-center rounded-lg px-3 text-[13px] font-medium whitespace-nowrap no-underline md:pl-7';
const on = 'bg-sidebar-active text-white';
const off = 'text-sidebar-text hover:bg-white/5 hover:text-white';

/** The items a user with these roles may see (a Super Admin sees an Admin's). */
function visible(roles: readonly Role[]) {
  return NAV.filter((item) => !item.roles || hasRole({ roles }, ...item.roles));
}

/** An item's sub-items, the one for this page highlighted (`current`; null: none, as in the fallback). */
function SubLinks({ item, current, highlight }: { item: NavItem; current: string | null; highlight: boolean }) {
  return item.items?.map((sub) => {
    const active = highlight && sub.href === current;
    return (
      <Link
        key={`sub:${sub.href}`}
        href={sub.href}
        aria-current={active ? 'page' : undefined}
        className={`${subBase} ${active ? on : highlight ? off : 'text-sidebar-text'}`}
      >
        {sub.label}
      </Link>
    );
  });
}

/** `counts`: how many things wait behind a link, by its href (e.g. endings waiting for the CEO, beside Approvals). */
export function NavLinks({ roles, counts }: { roles: Role[]; counts?: Partial<Record<string, number>> }) {
  const pathname = usePathname();
  return visible(roles).map((item) => {
    const active = item.section ? pathname.startsWith(item.section) : pathname === item.href;
    // on a page of a sub-item, the sub-item is the one highlighted; its item stays white, as the section it is in
    const current = active ? (activeSubItem(item, pathname)?.href ?? null) : null;
    const count = counts?.[item.href];
    return (
      <Fragment key={item.href}>
        <Link
          href={item.href}
          aria-current={active && !current ? 'page' : undefined}
          className={`${base} ${active ? (current ? 'text-white' : on) : off}`}
        >
          {item.label}
          {count ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white tabular-nums md:ml-auto">
              {count}
              <span className="sr-only"> waiting</span>
            </span>
          ) : null}
        </Link>
        <SubLinks item={item} current={current} highlight />
      </Fragment>
    );
  });
}

/**
 * Same links without the active highlight, shown until the current path and the user are known.
 * Items limited to some roles wait for the user, so they never flash up for someone who cannot use them.
 */
export function NavLinksFallback() {
  return visible([]).map((item) => (
    <Fragment key={item.href}>
      <Link href={item.href} className={`${base} text-sidebar-text`}>
        {item.label}
      </Link>
      <SubLinks item={item} current={null} highlight={false} />
    </Fragment>
  ));
}
