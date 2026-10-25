import Link from 'next/link';
import { LABELS, STANDING_LABELS, type EmployeeStatus, type EmploymentType, type ShiftTimes, type Standing } from '@trendlix/shared';
import { Hidden } from '@/components/hidden';
import { formatDate } from '@/lib/format';
import { HIDDEN_LABEL, isHidden, labelOf, readsHidden, withCode } from '@/lib/hidden';
import { shiftTimesText } from '@/lib/shifts';
import { hasRole } from '@/lib/roles';
import type { EmployeeProfile, SessionUser } from '@/lib/types';
import { BackLink, DAY_NAMES, Empty, Loading } from '../organization/ui';
import { reportStanding, STANDING_STYLE, standingOf, STATUS_STYLE, trainingStanding } from './standing';

// Small building blocks shared by the Employees pages (the generic ones come from the Organization pages).

export { BackLink, DAY_NAMES, Empty, Loading };

// The picture beside the name lives in a file of its own, without server code, for the crop window's preview too.
export { Avatar, initials, photoHref } from './avatar';

/** Only HR adds employees; the API checks this again on every change. */
export function canAddEmployees(user: SessionUser): boolean {
  return user.roles.includes('hr');
}

/** HR and the CEO open employee files (scanned paperwork) and search them; the API checks this again. */
export function canSeeEmployeeFiles(user: SessionUser): boolean {
  return user.roles.some((r) => r === 'hr' || r === 'ceo');
}

/**
 * HR and Admin (a Super Admin too) see the fixes the card reader learned from HR's corrections; only a Super Admin deletes
 * one. The API checks this again.
 */
export function canSeeCardFixes(user: SessionUser): boolean {
  return hasRole(user, 'hr', 'admin');
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

// the colours and the standing worked out, in standing.ts (pure, tested)
export { reportStanding, standingOf };

/**
 * An employment's status. With the current employment's type (`employmentType`), an intern's Active (or an older
 * Probation) shows as Intern (owner, 19 October 2026: "interns to be labeled trainees instead of probation").
 */
export function StatusBadge({ status, employmentType }: { status: EmployeeStatus; employmentType?: EmploymentType | null }) {
  const training = trainingStanding(status, employmentType);
  if (training) return <StandingBadge standing={training} />;
  return <span className={`badge ${STATUS_STYLE[status]}`}>{LABELS.status[status]}</span>;
}

/** Where someone stands: their current employment's status (Intern for an intern), or Former employee / Not employed yet. */
export function StandingBadge({ standing }: { standing: Standing }) {
  return <span className={`badge ${STANDING_STYLE[standing]}`}>{STANDING_LABELS[standing]}</span>;
}

/** "G4 · Senior": an employee's grade (each employment has its own, within the job title's range if it has one). */
export function gradeLabel(grade: { code: string; levelEn: string }): string {
  // hidden from a developer (22 October 2026: "Hide per-person details"): "Hidden"
  if (isHidden(grade.code)) return HIDDEN_LABEL;
  return `${grade.code} · ${grade.levelEn}`;
}

/** "A · 9:00 AM – 6:00 PM · 9:00 hours"; a flexible shift "MORNING · 9:00 AM – 7:00 PM · 9:00 hours, flexible". */
export function shiftLabel(shift: { code: string } & ShiftTimes): string {
  return `${shift.code} · ${shiftTimesText(shift)}`;
}

/** "Hybrid · in the office on Sun, Tue" */
export function arrangementLabel(e: { workArrangement: keyof typeof LABELS.workArrangement; officeDays: number[] }): string {
  // hidden from a developer (22 October 2026: "Hide per-person details"): "Hidden"
  if (e.workArrangement !== 'hybrid' || e.officeDays.length === 0) return labelOf(LABELS.workArrangement, e.workArrangement) ?? '';
  const days = [...e.officeDays].sort((a, b) => a - b).map((d) => DAY_NAMES[d]);
  return `${LABELS.workArrangement.hybrid} · in the office on ${days.join(', ')}`;
}

/** "01/03/2024 – now" or "01/03/2024 – 30/06/2026"; "Hidden" when a developer gets no join date (22 October 2026). */
export function periodLabel(e: { joinDate: string | null; endDate: string | null }): string {
  if (!e.joinDate) return HIDDEN_LABEL;
  return `${formatDate(e.joinDate)} – ${e.endDate ? formatDate(e.endDate) : 'now'}`;
}

// ---------- expiry of papers (the national ID, certificates) ----------

/** Papers close to expiry get a warning this many days ahead. */
export const EXPIRY_WARNING_DAYS = 60;

/** Today in Cairo, as YYYY-MM-DD. Call it after the page's data has loaded (it reads the clock). */
export function todayInCairo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

/** Valid, Expires soon (within 60 days) or Expired; "No expiry" when the paper has none. */
export function ExpiryChip({ expiry, today }: { expiry: string | null; today: string }) {
  if (!expiry) return <span className="text-xs text-muted">No expiry</span>;
  const days = (Date.parse(expiry) - Date.parse(today)) / 86_400_000;
  if (days < 0) return <span className="badge bg-danger-soft text-danger">Expired</span>;
  if (days <= EXPIRY_WARNING_DAYS) return <span className="badge bg-warn-soft text-warn">Expires soon</span>;
  return <span className="badge bg-ok-soft text-ok">Valid</span>;
}

// ---------- the profile's field grid (after Prime ERP's owner profile) ----------

/** A small word beside a field's label: Required (counted in the profile's completeness) or Protected (restricted). */
export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="ml-1.5 rounded-sm bg-accent-soft px-1 py-px align-[1px] text-[9.5px] font-semibold tracking-wide text-accent">{children}</span>;
}

export type GridField = {
  /** Also the cell's anchor (#field-<key>), which the completeness links point at. */
  key: string;
  label: string;
  /** null, undefined or '' = nothing recorded. */
  value: React.ReactNode;
  /** Counted in the profile's completeness: tagged Required, and "Not captured" (highlighted) while empty. */
  required?: boolean;
  /** Restricted (the national ID number, bank numbers): tagged Protected. */
  protected?: boolean;
  /** Arabic text, shown right to left. */
  ar?: boolean;
  /** A note under the value, e.g. "Viewing this is recorded." */
  note?: React.ReactNode;
  /**
   * Hidden from a developer (owner, 22 October 2026: "Hide per-person details"): shown as Hidden, never as not captured,
   * without its note. A value the API sent as "••••" is Hidden anyway.
   */
  hidden?: boolean;
};

const isEmpty = (v: React.ReactNode) => v === null || v === undefined || v === '' || v === false;

/**
 * One cell per field, label above value. A required field that is empty is highlighted as not captured yet. A cell
 * holding a form that is open (`data-editing`, e.g. the Social Insurance tab's occupation) takes the whole row.
 */
export function FieldGrid({ fields }: { fields: GridField[] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] overflow-hidden rounded-lg border border-line bg-card">
      {fields.map((f) => {
        const hidden = f.hidden === true || readsHidden(f.value);
        const empty = !hidden && isEmpty(f.value);
        const missing = empty && f.required;
        return (
          <div
            key={f.key}
            id={`field-${f.key}`}
            className={`-mr-px -mb-px min-w-0 scroll-mt-6 border-r border-b border-line px-4 py-3 target:ring-2 target:ring-accent target:ring-inset has-[[data-editing]]:col-span-full ${missing ? 'bg-warn-soft' : ''}`}
          >
            <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
              {f.label}
              {f.required && <Tag>Required</Tag>}
              {f.protected && <Tag>Protected</Tag>}
            </dt>
            <dd className="mt-1 text-sm break-words">
              {hidden ? (
                <Hidden />
              ) : empty ? (
                f.required ? (
                  <span className="text-muted italic">Not captured</span>
                ) : (
                  <span className="text-muted">—</span>
                )
              ) : f.ar ? (
                <span lang="ar" dir="rtl" className="inline-block">
                  {f.value}
                </span>
              ) : (
                f.value
              )}
            </dd>
            {f.note && !hidden && <div className="mt-1 text-xs text-muted">{f.note}</div>}
          </div>
        );
      })}
    </dl>
  );
}

/** A titled part of a profile tab: the title, an optional note and Restricted badge, the actions on the right, then its content. */
export function ProfileSection({
  title,
  note,
  restricted = false,
  editHref,
  actions,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  restricted?: boolean;
  /** An Edit link to the page that changes this part. */
  editHref?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-semibold">
          {title}
          {restricted && <span className="badge ml-2 bg-line-soft align-middle text-muted">Restricted</span>}
        </h2>
        {note && <span className="text-xs text-muted">{note}</span>}
        {(editHref || actions) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {editHref && (
              // No prefetch: the restricted edit pages fetch full, audited values.
              <Link href={editHref} prefetch={false} className="btn btn-secondary min-h-9 px-3">
                Edit<span className="sr-only"> {title.toLowerCase()}</span>
              </Link>
            )}
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/** Top of every edit page: back to the profile (or one of its tabs), the page title, whose record it is. */
export function EditHeading({
  profile,
  title,
  backHref,
}: {
  profile: Pick<EmployeeProfile, 'id' | 'fullNameEn' | 'employeeCode'>;
  title: string;
  backHref?: string;
}) {
  return (
    <div className="space-y-2">
      <BackLink href={backHref ?? `/employees/${profile.id}`}>{profile.fullNameEn}</BackLink>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted">
        {withCode(profile.fullNameEn, profile.employeeCode)}
      </p>
    </div>
  );
}

// The profile's tabs (Basic Data | Employment | Social Insurance | Documents), the Employment tab's sub-tabs
// (Details | Salary | Issued Documents) and their addresses live in pure code, for tested helpers that link to a tab.
export {
  askedTab,
  contractDocumentsHref,
  contractHref,
  EMPLOYMENT_SUB_TABS,
  employeeRaiseRequestsHref,
  employmentHref,
  PROFILE_TABS,
  payslipsHref,
  profileHref,
  salaryHistoryHref,
  tabShowing,
  type EmploymentSubTabKey,
  type ProfileTabKey,
} from './tab-list';
