'use client';

import type { Role } from '@trendlix/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { hasRole } from '@/lib/roles';
import { NAV } from './nav';

const base = 'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium no-underline';

/** The items a user with these roles may see (a Super Admin sees an Admin's). */
function visible(roles: readonly Role[]) {
  return NAV.filter((item) => !item.roles || hasRole({ roles }, ...item.roles));
}

/** `counts`: how many things wait behind a link, by its href (e.g. endings waiting for the CEO, beside Approvals). */
export function NavLinks({ roles, counts }: { roles: Role[]; counts?: Partial<Record<string, number>> }) {
  const pathname = usePathname();
  return visible(roles).map((item) => {
    const active = item.section ? pathname.startsWith(item.section) : pathname === item.href;
    const count = counts?.[item.href];
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`${base} ${active ? 'bg-sidebar-active text-white' : 'text-sidebar-text hover:bg-white/5 hover:text-white'}`}
      >
        {item.label}
        {count ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white tabular-nums md:ml-auto">
            {count}
            <span className="sr-only"> waiting</span>
          </span>
        ) : null}
      </Link>
    );
  });
}

/**
 * Same links without the active highlight, shown until the current path and the user are known.
 * Items limited to some roles wait for the user, so they never flash up for someone who cannot use them.
 */
export function NavLinksFallback() {
  return visible([]).map((item) => (
    <Link key={item.href} href={item.href} className={`${base} text-sidebar-text`}>
      {item.label}
    </Link>
  ));
}
