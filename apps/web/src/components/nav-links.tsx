'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from './nav';

const base = 'flex min-h-11 items-center rounded-lg px-3 text-sm font-medium no-underline';

export function NavLinks() {
  const pathname = usePathname();
  return NAV.map((item) => {
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

/** Same links without the active highlight, shown until the current path is known. */
export function NavLinksFallback() {
  return NAV.map((item) => (
    <Link key={item.href} href={item.href} className={`${base} text-sidebar-text`}>
      {item.label}
    </Link>
  ));
}
