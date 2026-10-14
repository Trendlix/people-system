import Link from 'next/link';

// Rendered by each section's own layout, so the active tab is known on the server
// and shows immediately (reading the URL in the browser would flash an unselected state).
const TABS = [
  { key: 'company', href: '/organization/company', label: 'Company' },
  { key: 'departments', href: '/organization/departments', label: 'Departments & Job Titles' },
  { key: 'shifts', href: '/organization/shifts', label: 'Shifts' },
] as const;

export type TabKey = (typeof TABS)[number]['key'];

const base = 'inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-semibold whitespace-nowrap no-underline';

export function OrgTabs({ active, children }: { active: TabKey; children: React.ReactNode }) {
  return (
    <>
      <nav aria-label="Organization" className="mt-4 flex gap-6 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === active ? 'page' : undefined}
            className={`${base} ${t.key === active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </>
  );
}
