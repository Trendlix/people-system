import Link from 'next/link';
import { END_REASON_LABELS, LABELS } from '@trendlix/shared';
import { departmentName } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile, Employment } from '@/lib/types';
import { deleteEmployment } from '../employment-actions';
import { arrangementLabel, FieldGrid, gradeLabel, periodLabel, ProfileSection, shiftLabel, StatusBadge, type GridField } from '../ui';
import { DeleteRowButton } from './inline-forms';

// The Employment tab: the current employment (Edit, End employment), or a way to add one; every employment in the
// history, newest first; and the people who report to this person now. HR changes employments; HR and Admin may
// delete one added by mistake (the API checks both again).

const dash = <span className="text-muted">—</span>;
const small = 'btn min-h-9 px-3';

/** "Marketing › Content Team"; older employments may sit directly in a department, from before teams. */
const placeLabel = (e: Employment) => (e.department && !e.department.parent ? 'Department' : 'Team');

/** The current employment's details, in the profile's field grid. */
function employmentFields(e: Employment, linkPeople: boolean): GridField[] {
  const grade = e.jobTitle?.grade; // an employee's grade is their job title's
  return [
    { key: 'employmentType', label: 'Employment type', value: LABELS.employmentType[e.employmentType] },
    { key: 'status', label: 'Status', value: <StatusBadge status={e.status} /> },
    { key: 'team', label: placeLabel(e), value: e.department && departmentName(e.department) },
    {
      key: 'jobTitle',
      label: 'Job title',
      value: e.jobTitle?.titleEn,
      note: e.jobTitle?.titleAr && (
        <span lang="ar" dir="rtl">
          {e.jobTitle.titleAr}
        </span>
      ),
    },
    {
      key: 'grade',
      label: 'Grade',
      value: grade && gradeLabel(grade),
      note: grade?.levelAr && (
        <span lang="ar" dir="rtl">
          {grade.levelAr}
        </span>
      ),
    },
    {
      key: 'manager',
      label: 'Direct manager',
      value: e.manager && (linkPeople ? <Link href={`/employees/${e.manager.id}`}>{e.manager.fullNameEn}</Link> : e.manager.fullNameEn),
    },
    { key: 'joinDate', label: 'Join date', value: formatDate(e.joinDate) },
    { key: 'probationEnd', label: 'Probation end date', value: formatDate(e.probationEnd) },
    { key: 'workArrangement', label: 'Work arrangement', value: arrangementLabel(e) },
    { key: 'shift', label: 'Shift', value: e.shift && shiftLabel(e.shift) },
    {
      key: 'jdAcknowledgedAt',
      label: 'Job description acknowledged',
      value: e.jdAcknowledgedAt ? formatDate(e.jdAcknowledgedAt) : <span className="text-muted">Not yet</span>,
      note: e.jobTitle && `Version ${e.jobTitle.jdVersion}`,
    },
  ];
}

/** What an employment was, for a confirmation: "the Full-time employment as Senior Designer, 01/03/2024 – now". */
function described(e: Employment): string {
  return `the ${LABELS.employmentType[e.employmentType].toLowerCase()} employment${e.jobTitle ? ` as ${e.jobTitle.titleEn}` : ''}, ${periodLabel(e)}`;
}

function History({ profile: p }: { profile: EmployeeProfile }) {
  const base = `/employees/${p.id}`;
  const actions = p.access.edit || p.access.delete;
  if (p.employments.length === 0) {
    return <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">No employments yet.</p>;
  }
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Type</th>
            <th>Team</th>
            <th>Job Title</th>
            <th>Grade</th>
            <th>Status</th>
            <th>Note</th>
            {actions && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {p.employments.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap tabular-nums">
                {periodLabel(e)}
                {!e.endDate && <span className="badge ml-2 align-middle">Current</span>}
              </td>
              <td className="whitespace-nowrap">{LABELS.employmentType[e.employmentType]}</td>
              <td>{e.department ? departmentName(e.department) : dash}</td>
              <td>{e.jobTitle?.titleEn ?? dash}</td>
              <td className="whitespace-nowrap">{e.jobTitle?.grade ? gradeLabel(e.jobTitle.grade) : dash}</td>
              <td>
                {e.endDate ? (
                  <span className="badge bg-line-soft text-muted">{e.endReason ? END_REASON_LABELS[e.endReason] : LABELS.status[e.status]}</span>
                ) : (
                  <StatusBadge status={e.status} />
                )}
              </td>
              <td className="max-w-64 min-w-40 text-muted">{e.endNote ?? dash}</td>
              {actions && (
                <td>
                  <div className="flex items-center justify-end gap-4 whitespace-nowrap">
                    {p.access.edit && (
                      <Link href={`${base}/employment/${e.id}/edit`} className="inline-flex min-h-9 items-center text-sm font-semibold">
                        Edit<span className="sr-only"> {described(e)}</span>
                      </Link>
                    )}
                    {p.access.delete && (
                      <DeleteRowButton
                        action={deleteEmployment.bind(null, p.id, e.id)}
                        name={described(e)}
                        confirmText={`Delete ${described(e)}? Only for an employment added by mistake: it is taken out of ${p.fullNameEn}'s history. This cannot be undone.`}
                      />
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The people whose current employment reports to this person (who can always open their profiles). */
function DirectReports({ profile: p }: { profile: EmployeeProfile }) {
  return (
    <ProfileSection title="Direct Reports" note={`${p.reports.length} ${p.reports.length === 1 ? 'person reports' : 'people report'} to ${p.fullNameEn}`}>
      <ul className="card px-6 py-2">
        {p.reports.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-3 last:border-0">
            <div className="min-w-0">
              <Link href={`/employees/${r.id}`} className="text-sm font-semibold">
                {r.fullNameEn}
              </Link>
              <p className="text-xs text-muted">
                {r.employeeCode}
                {r.jobTitle && ` · ${r.jobTitle.titleEn}`}
              </p>
            </div>
            <StatusBadge status={r.status} />
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}

export function EmploymentTab({
  profile: p,
  linkPeople,
  justAdded = false,
}: {
  profile: EmployeeProfile;
  linkPeople: boolean;
  /** Just after Add employee saved the profile: say so, and what comes next. */
  justAdded?: boolean;
}) {
  const e = p.employment;
  const base = `/employees/${p.id}`;
  const lastEnded = e ? null : p.employments.find((x) => x.endDate);

  return (
    <div className="space-y-8">
      {justAdded && !e && p.employments.length === 0 && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          The profile of {p.fullNameEn} is saved, with the ID card in the employee file. Next, add the employment.
        </p>
      )}
      {e ? (
        <ProfileSection
          title="Current Employment"
          note={`Since ${formatDate(e.joinDate)}`}
          actions={
            p.access.edit && (
              <>
                <Link href={`${base}/employment/${e.id}/edit`} className={`${small} btn-secondary`}>
                  Edit<span className="sr-only"> current employment</span>
                </Link>
                <Link href={`${base}/employment/${e.id}/end`} className={`${small} btn-danger`}>
                  End employment
                </Link>
              </>
            )
          }
        >
          <FieldGrid fields={employmentFields(e, linkPeople)} />
        </ProfileSection>
      ) : (
        <ProfileSection title="Current Employment">
          <div className="card space-y-4 px-6 py-8 text-center">
            <p className="text-sm text-muted">
              {lastEnded?.endDate
                ? `No current employment. ${p.fullNameEn} left on ${formatDate(lastEnded.endDate)}${lastEnded.endReason ? ` (${END_REASON_LABELS[lastEnded.endReason].toLowerCase()})` : ''}. The profile and the employment history are kept.`
                : `${p.fullNameEn} is not employed yet. Add the employment once they are hired: type, team and job title, manager, join date.`}
            </p>
            {p.access.edit && (
              <Link href={`${base}/employment/new`} className="btn btn-primary">
                {lastEnded ? 'Add a new employment' : 'Add employment'}
              </Link>
            )}
          </div>
        </ProfileSection>
      )}

      <ProfileSection
        title="Employment History"
        note={p.employments.length > 0 && `${p.employments.length} ${p.employments.length === 1 ? 'employment' : 'employments'}, newest first`}
      >
        <History profile={p} />
      </ProfileSection>

      {p.reports.length > 0 && <DirectReports profile={p} />}
    </div>
  );
}
