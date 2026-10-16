import Link from 'next/link';
import { PAYROLL_SECTIONS, type PayrollSection } from './sections';

// The Payroll pages' tabs (owner, 17 October 2026: Overview, Unsettled, Additions / Deductions, Reports), drawn by each
// page on the server, so the active one shows at once, as the Organization tabs.

const base = 'inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-semibold whitespace-nowrap no-underline';

export function PayrollTabs({ active }: { active: PayrollSection }) {
  return (
    <nav aria-label="Payroll" className="mt-4 flex gap-6 overflow-x-auto border-b border-line">
      {PAYROLL_SECTIONS.map((t) => (
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
  );
}
