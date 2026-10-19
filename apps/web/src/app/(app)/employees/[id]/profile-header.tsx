import Link from 'next/link';
import { Fragment } from 'react';
import { END_REASON_LABELS, LABELS } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { DocumentViewer } from '@/components/document-viewer';
import { cLevelTitle } from '@/lib/confidential';
import { departmentName } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile, ProfileGap } from '@/lib/types';
import { confirmationStatus, pendingRequest } from '../confirmation';
import { Avatar, gradeLabel, photoHref, PROFILE_TABS, profileHref, standingOf, StandingBadge, tabShowing, type ProfileTabKey } from '../ui';
import { ConfirmedNotice } from './confirm/confirm-notices';
import { PhotoCropButton } from './photo-crop';

// Above the profile's tabs: who it is, where they stand, their current job, whether the employee confirmed their
// details, and how complete the profile is. A C-level person's (owner, 19 October 2026: "make C level Employees details
// not visible to HR"), which only the CEO, the Super Admin and they themself open, is marked C-level, and their change
// requests wait for the CEO rather than HR.

/** Where a missing item is filled in: the field's cell on Basic Data (Education is there too) or Employment, or the paper's row on Documents. */
function gapHref(id: string, gap: ProfileGap): string {
  return `${profileHref(id, gap.tab)}#${gap.tab === 'documents' ? 'paper' : 'field'}-${gap.key}`;
}

// The national ID and bank cells are on Basic Data only for those who may see them; the list names them for everyone.
const IDENTITY_KEYS: ReadonlySet<string> = new Set(['nationalId', 'printedNo', 'idIssueDate', 'idExpiry']);
const BANK_KEYS: ReadonlySet<string> = new Set(['bankName', 'accountNo', 'iban', 'holderName']);

/** Whether the caller can open where a missing item is filled in: its tab and, for the national ID and bank, that section. */
function reachable(gap: ProfileGap, access: EmployeeProfile['access'], tabs: ReadonlySet<ProfileTabKey>): boolean {
  if (!tabs.has(tabShowing(gap.tab))) return false;
  if (gap.tab === 'basic' && IDENTITY_KEYS.has(gap.key)) return access.identity;
  if (gap.tab === 'basic' && BANK_KEYS.has(gap.key)) return access.bank;
  return true;
}

/** "Profile 80% complete", a meter, and what is missing, grouped by tab; each item links to where it is filled in, when the caller can open it. */
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
                  {reachable(gap, profile.access, tabs) ? (
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

const STATUS_TONE = { ok: 'text-ok', changed: 'text-warn', none: 'text-muted' } as const;

/**
 * Whether the employee confirmed their details (owner's decision, 15 October 2026), for everyone who sees the profile.
 * The employee gets Review and confirm while it isn't up to date; HR and Admin, who decide change requests
 * (`decidesRequests`), a link to Approvals when one waits. Nothing before the API sends confirmations.
 */
function Confirmation({ profile: p, decidesRequests }: { profile: EmployeeProfile; decidesRequests: boolean }) {
  const status = confirmationStatus(p.confirmation);
  if (!status) return null;
  const upToDate = p.confirmation?.upToDate;
  const pending = pendingRequest(p.changeRequests);
  // a C-level person's change requests are the CEO's (or a Super Admin's) to decide, not HR's (19 October 2026)
  const decider = p.confidential ? 'the CEO' : 'HR';
  // HR (who edit the profile) see a profile never confirmed in the warning colour: it is theirs to follow up
  const tone = status.tone === 'none' && p.access.edit ? 'text-warn' : STATUS_TONE[status.tone];
  const waiting = 'badge bg-warn-soft text-warn no-underline';

  return (
    <div className="space-y-3 border-t border-line pt-4">
      {p.isSelf && <ConfirmedNotice />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <p className={`font-medium ${tone}`}>{status.text}</p>
        {p.isSelf ? (
          <>
            {!upToDate && (
              <Link href={`/employees/${p.id}/confirm`} className="btn btn-primary min-h-9 px-3">
                Review and confirm
              </Link>
            )}
            {pending ? (
              <Link href={`/employees/${p.id}/change-request`} className={waiting}>
                Your change request is waiting for {decider}
              </Link>
            ) : (
              upToDate && <Link href={`/employees/${p.id}/change-request`}>Request a change</Link>
            )}
          </>
        ) : (
          pending &&
          // HR and Admin decide on Approvals, a C-level person's the CEO or a Super Admin (19 October 2026); anyone else
          // sees it waiting
          (decidesRequests ? (
            <Link href="/approvals" className={waiting}>
              Change request waiting
            </Link>
          ) : (
            <span className={waiting}>Change request waiting for {decider}</span>
          ))
        )}
      </div>
    </div>
  );
}

export function ProfileHeader({
  profile: p,
  tabs,
  linkPeople,
  decidesRequests,
}: {
  profile: EmployeeProfile;
  /** The tabs the caller can open (Documents: HR and CEO). */
  tabs: ReadonlySet<ProfileTabKey>;
  /** Only people who can open every profile get links to others (e.g. the manager). */
  linkPeople: boolean;
  /** HR and Admin decide employees' change requests, on Approvals; a C-level person's, the CEO or a Super Admin. */
  decidesRequests: boolean;
}) {
  const e = p.employment;
  const standing = standingOf(p);
  const lastEnded = e ? null : p.employments.find((x) => x.endDate);
  const grade = e?.grade; // the person's own grade in their current employment
  // "Graphic Designer · G4 · Senior · Marketing › Content Team"
  const role = e && [e.jobTitle?.titleEn, grade && gradeLabel(grade), e.department && departmentName(e.department)].filter(Boolean).join(' · ');

  return (
    <section className="card space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-6">
        {p.photoId ? (
          <div className="group relative flex shrink-0">
            {/* the whole photo opens larger in a pop-up window (owner's request, 16 October 2026) */}
            <DocumentViewer
              title={`Personal Photo · ${p.fullNameEn}`}
              files={[{ alt: `Personal photo of ${p.fullNameEn}`, src: photoHref(p.photoId) }]}
              className="shrink-0 cursor-zoom-in rounded-full outline-none hover:ring-4 hover:ring-accent/20 focus-visible:ring-4 focus-visible:ring-accent/40"
            >
              <Avatar name={p.fullNameEn} photoId={p.photoId} crop={p.photoCrop} size="lg" />
              <span className="sr-only">View the personal photo</span>
            </DocumentViewer>
            {/* HR crops the picture beside the name to make the face bigger, the photo itself unchanged (owner's request,
                16 October 2026); the API checks the role again */}
            {p.access.edit && <PhotoCropButton photoId={p.photoId} crop={p.photoCrop ?? null} name={p.fullNameEn} />}
          </div>
        ) : (
          <Avatar name={p.fullNameEn} size="lg" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold">{p.fullNameEn}</h1>
            <span lang="ar" dir="rtl" className="text-lg text-muted">
              {p.fullNameAr}
            </span>
            <StandingBadge standing={standing} />
            {e && <span className="badge bg-line-soft text-ink">{LABELS.employmentType[e.employmentType]}</span>}
            {p.confidential && <CLevelBadge title={cLevelTitle(false)} />}
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
      <Confirmation profile={p} decidesRequests={decidesRequests} />
      <Completeness profile={p} tabs={tabs} />
    </section>
  );
}
