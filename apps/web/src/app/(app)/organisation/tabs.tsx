import Link from 'next/link';

// Rendered by each section's own layout, so the active tab is known on the server
// and shows immediately (reading the URL in the browser would flash an unselected state).
const TABS = [
  { key: 'company', href: '/organisation/company', label: 'Company' },
  { key: 'departments', href: '/organisation/departments', label: 'Departments' },
  { key: 'job-titles', href: '/organisation/job-titles', label: 'Job titles' },
  { key: 'shifts', href: '/organisation/shifts', label: 'Shifts' },
] as const;

export type TabKey = (typeof TABS)[number]['key'];

const base = 'inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-semibold whitespace-nowrap no-underline';

export function OrgTabs({ active, children }: { active: TabKey; children: React.ReactNode }) {
  return (
    <>
      <nav aria-label="Organisation" className="mt-4 flex gap-6 overflow-x-auto border-b border-line">
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
