import Link from 'next/link';
import { LABELS, type EmployeeStatus } from '@trendlix/shared';
import { formatTime } from '@/lib/format';
import type { EmployeeProfile, SessionUser } from '@/lib/types';
import { BackLink, DAY_NAMES, Empty, Loading } from '../organization/ui';

// Small building blocks shared by the Employees pages (the generic ones come from the Organization pages).

export { BackLink, DAY_NAMES, Empty, Loading };

/** Only HR adds employees; the API checks this again on every change. */
export function canAddEmployees(user: SessionUser): boolean {
  return user.roles.includes('hr');
}

/** HR and the CEO open employee files (scanned paperwork) and search them; the API checks this again. */
export function canSeeEmployeeFiles(user: SessionUser): boolean {
  return user.roles.some((r) => r === 'hr' || r === 'ceo');
}

/** HR, the CEO and Finance see everyone; managers see their team; everyone else sees only themselves. */
export function seesEveryone(user: SessionUser): boolean {
  return user.roles.some((r) => r === 'hr' || r === 'ceo' || r === 'finance');
}

/** Shows the children only when the API says the caller may edit this employee (HR); others get a short explanation. */
export function RequireHr({ profile, children }: { profile: Pick<EmployeeProfile, 'access'>; children: React.ReactNode }) {
  if (!profile.access.edit) return <Empty>Only HR can change employee records.</Empty>;
  return children;
}

const STATUS_STYLE: Record<EmployeeStatus, string> = {
  active: 'bg-ok-soft text-ok',
  probation: '', // the badge's own accent colours
  on_leave: 'bg-warn-soft text-warn',
  notice_period: 'bg-line-soft text-muted',
  resigned: 'bg-line-soft text-muted',
  terminated: 'bg-line-soft text-muted',
};

export function StatusBadge({ status }: { status: EmployeeStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{LABELS.status[status]}</span>;
}

/** "Omar Khaled Mahmoud" → "OM": first letters of the first and last names. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'size-20 text-2xl' : 'size-9 text-xs';
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent ${box}`}>
      {initials(name)}
    </span>
  );
}

/** "A · 9:00 AM – 6:00 PM" */
export function shiftLabel(shift: { code: string; startTime: string; endTime: string }): string {
  return `${shift.code} · ${formatTime(shift.startTime)} – ${formatTime(shift.endTime)}`;
}

/** One label / value line in a profile card; empty values show "Not set". */
export function Row({ label, children, ar = false }: { label: string; children: React.ReactNode; ar?: boolean }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="grid gap-1 border-b border-line-soft py-3 last:border-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words">
        {empty ? (
          <span className="text-muted">Not set</span>
        ) : ar ? (
          <span lang="ar" dir="rtl" className="inline-block">
            {children}
          </span>
        ) : (
          children
        )}
      </dd>
    </div>
  );
}

/** A profile card: title, optional "Restricted" tag and Edit link, then its rows (or `emptyText` when nothing is recorded). */
export function Section({
  title,
  editHref,
  restricted = false,
  emptyText,
  children,
}: {
  title: string;
  editHref?: string;
  restricted?: boolean;
  emptyText?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          {title}
          {restricted && <span className="badge ml-2 bg-line-soft align-middle text-muted">Restricted</span>}
        </h2>
        {editHref && (
          // No prefetch: the restricted edit pages fetch full, audited values.
          <Link href={editHref} prefetch={false} className="text-sm font-semibold">
            Edit<span className="sr-only"> {title.toLowerCase()}</span>
          </Link>
        )}
      </div>
      {emptyText ? <p className="mt-3 text-sm text-muted">{emptyText}</p> : <dl className="mt-3">{children}</dl>}
    </section>
  );
}

/** Top of every edit page: back to the profile, the page title, whose record it is. */
export function EditHeading({ profile, title }: { profile: Pick<EmployeeProfile, 'id' | 'fullNameEn' | 'employeeCode'>; title: string }) {
  return (
    <div className="space-y-2">
      <BackLink href={`/employees/${profile.id}`}>{profile.fullNameEn}</BackLink>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted">
        {profile.fullNameEn} · {profile.employeeCode}
      </p>
    </div>
  );
}
