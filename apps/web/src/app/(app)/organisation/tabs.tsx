'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const TABS = [
  { href: '/organisation/departments', label: 'Departments' },
  { href: '/organisation/job-titles', label: 'Job titles' },
  { href: '/organisation/shifts', label: 'Shifts' },
];

const base = 'inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-semibold no-underline';

export function Tabs() {
  const pathname = usePathname();
  return TABS.map((t) => {
    const active = pathname.startsWith(t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        aria-current={active ? 'page' : undefined}
        className={`${base} ${active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
      >
        {t.label}
      </Link>
    );
  });
}

export function TabsFallback() {
  return TABS.map((t) => (
    <Link key={t.href} href={t.href} className={`${base} border-transparent text-muted`}>
      {t.label}
    </Link>
  ));
}
