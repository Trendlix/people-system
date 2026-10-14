'use client';

import type { Role } from '@trendlix/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from './nav';

const base = 'flex min-h-11 items-center rounded-lg px-3 text-sm font-medium no-underline';

/** The items a user with these roles may see. */
function visible(roles: readonly Role[]) {
  return NAV.filter((item) => !item.roles || item.roles.some((r) => roles.includes(r)));
}

export function NavLinks({ roles }: { roles: Role[] }) {
  const pathname = usePathname();
  return visible(roles).map((item) => {
    const active = item.section ? pathname.startsWith(item.section) : pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`${base} ${active ? 'bg-sidebar-active text-white' : 'text-sidebar-text hover:bg-white/5 hover:text-white'}`}
      >
        {item.label}
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
