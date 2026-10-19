import { CONFIDENTIAL_NOTE } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { cLevelTitle } from '@/lib/confidential';
import { departmentName } from '@/lib/departments';
import type { EmployeeCard } from '@/lib/types';
import { Avatar, StandingBadge } from '../ui';

// A C-level person's directory card, in place of their profile, for those who may not see them (owner, 19 October 2026:
// "make C level Employees details not visible to HR"): HR, Finance, Admin and managers. Who they are and where they
// work, and the note that says why there is nothing more; no tabs and no actions, as the API answers 404 for every
// other record of theirs. The CEO and the Super Admin, and the person themself, get the profile.

export function EmployeeCardView({ card: c }: { card: EmployeeCard }) {
  const e = c.employment;
  // "Chief Executive Officer · Management"
  const role = e && [e.jobTitle?.titleEn, e.department && departmentName(e.department)].filter(Boolean).join(' · ');
  return (
    <section className="card space-y-5 p-6" aria-labelledby="employee-card-name">
      <div className="flex flex-wrap items-center gap-6">
        <Avatar name={c.fullNameEn} photoId={c.photoId} crop={c.photoCrop} size="lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 id="employee-card-name" className="text-2xl font-semibold">
              {c.fullNameEn}
            </h1>
            <span lang="ar" dir="rtl" className="text-lg text-muted">
              {c.fullNameAr}
            </span>
            <StandingBadge standing={c.standing} />
            <CLevelBadge title={cLevelTitle(true)} />
          </div>
          <p className="text-muted">{e ? role || 'No job title yet' : c.standing === 'former' ? 'Former employee' : 'Not employed yet'}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span className="rounded-md bg-ink px-2.5 py-1 font-semibold text-white tabular-nums">{c.employeeCode}</span>
            {c.workEmail && (
              <a href={`mailto:${c.workEmail}`} className="break-all">
                {c.workEmail}
              </a>
            )}
          </div>
        </div>
      </div>
      <p className="border-t border-line pt-4 text-sm text-muted">{c.note || CONFIDENTIAL_NOTE}</p>
    </section>
  );
}
