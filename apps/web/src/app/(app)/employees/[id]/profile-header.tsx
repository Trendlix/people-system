import Link from 'next/link';
import { Fragment } from 'react';
import { END_REASON_LABELS, LABELS } from '@trendlix/shared';
import { departmentName } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile, ProfileGap } from '@/lib/types';
import { Avatar, gradeLabel, PROFILE_TABS, profileHref, standingOf, StandingBadge, type ProfileTabKey } from '../ui';

// Above the profile's tabs: who it is, where they stand, their current job, and how complete the profile is.

/** Where a missing item is filled in: the field's cell on Basic Data or Education, or the paper's row on Documents. */
function gapHref(id: string, gap: ProfileGap): string {
  return `${profileHref(id, gap.tab)}#${gap.tab === 'documents' ? 'paper' : 'field'}-${gap.key}`;
}

/** "Profile 80% complete", a meter, and what is missing, grouped by tab; each item links to where it is filled in. */
function Completeness({ profile, tabs }: { profile: EmployeeProfile; tabs: ReadonlySet<ProfileTabKey> }) {
  const { percent, missing } = profile.completeness;
  const groups = PROFILE_TABS.map((t) => ({ ...t, gaps: missing.filter((m) => m.tab === t.key) })).filter((g) => g.gaps.length > 0);
  return (
    <div className="space-y-2 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm">
          Profile <b className="text-lg tabular-nums">{percent}%</b> complete
        </p>
        <span aria-hidden="true" className="block h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-line-soft">
          <span className={`block h-full rounded-full ${percent === 100 ? 'bg-ok' : 'bg-accent'}`} style={{ width: `${percent}%` }} />
        </span>
        {missing.length === 0 ? (
          <span className="badge bg-ok-soft text-ok">Nothing missing</span>
        ) : (
          <span className="badge bg-warn-soft text-warn">{missing.length} missing</span>
        )}
      </div>
      {groups.length > 0 && (
        <ul className="space-y-1 text-sm">
          {groups.map((g) => (
            <li key={g.key}>
              <span className="font-medium">{g.label}:</span>{' '}
              {g.gaps.map((gap, i) => (
                <Fragment key={gap.key}>
                  {i > 0 && ', '}
                  {tabs.has(g.key) ? (
                    <Link href={gapHref(profile.id, gap)} className="text-accent hover:underline">
                      {gap.label}
                    </Link>
                  ) : (
                    <span className="text-muted">{gap.label}</span>
                  )}
                </Fragment>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProfileHeader({
  profile: p,
  tabs,
  linkPeople,
}: {
  profile: EmployeeProfile;
  /** The tabs the caller can open (Documents: HR and CEO). */
  tabs: ReadonlySet<ProfileTabKey>;
  /** Only people who can open every profile get links to others (e.g. the manager). */
  linkPeople: boolean;
}) {
  const e = p.employment;
  const standing = standingOf(p);
  const lastEnded = e ? null : p.employments.find((x) => x.endDate);
  const grade = e?.jobTitle?.grade; // an employee's grade is their job title's
  // "Senior Graphic Designer · G4 · Senior · Marketing › Content Team"
  const role = e && [e.jobTitle?.titleEn, grade && gradeLabel(grade), e.department && departmentName(e.department)].filter(Boolean).join(' · ');

  return (
    <section className="card space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-6">
        <Avatar name={p.fullNameEn} size="lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold">{p.fullNameEn}</h1>
            <span lang="ar" dir="rtl" className="text-lg text-muted">
              {p.fullNameAr}
            </span>
            <StandingBadge standing={standing} />
            {e && <span className="badge bg-line-soft text-ink">{LABELS.employmentType[e.employmentType]}</span>}
          </div>
          <p className="text-muted">
            {e
              ? role || 'No job title yet'
              : lastEnded?.endDate
                ? [
                    lastEnded.jobTitle && `Was ${lastEnded.jobTitle.titleEn}`,
                    `Left ${formatDate(lastEnded.endDate)}`,
                    lastEnded.endReason && END_REASON_LABELS[lastEnded.endReason],
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'Not employed yet'}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span className="rounded-md bg-ink px-2.5 py-1 font-semibold text-white tabular-nums">{p.employeeCode}</span>
            {e?.manager && (
              <span>
                Reports to {linkPeople ? <Link href={`/employees/${e.manager.id}`}>{e.manager.fullNameEn}</Link> : e.manager.fullNameEn}
              </span>
            )}
            {e && <span>Joined {formatDate(e.joinDate)}</span>}
          </div>
        </div>
      </div>
      <Completeness profile={p} tabs={tabs} />
    </section>
  );
}
