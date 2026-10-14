'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, LABELS, PROBATION_MONTHS, WORK_ARRANGEMENTS } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { valueOf } from '@/components/form';
import { groupDepartments } from '@/lib/departments';
import { formatDate, formatTime } from '@/lib/format';
import type { Department, EmployeeSummary, Employment, FormState, JobTitleSummary, Shift } from '@/lib/types';

// The fields of an employment, used by the Add employment and Edit employment pages.

export type EmploymentPickers = {
  departments: Department[];
  jobTitles: JobTitleSummary[];
  shifts: Shift[];
  /** Who can be picked as direct manager (GET /employees), without the employee themself. */
  managers: EmployeeSummary[];
};

const OFFICE_DAYS = [
  [0, 'Sun'],
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
] as const;

/** The statuses of a current employment; Resigned and Terminated come from ending it (End employment). */
const CURRENT_STATUSES = EMPLOYEE_STATUSES.filter((s) => s !== 'resigned' && s !== 'terminated');

/** Only people with a current employment can be picked as a new manager. */
const EMPLOYED: readonly string[] = ['active', 'probation', 'on_leave', 'notice_period'];

/**
 * The Team picker (Department → Team → Job title): each department, in the API's order, as a group of its teams. A
 * department itself is only listed when the employee is already in it (from before teams), so saving doesn't lose it.
 */
function teamGroups(departments: Department[], keepId: string | null | undefined) {
  return groupDepartments(departments).flatMap(({ department, teams }) => {
    // a team whose department is missing from the list comes back as a group of its own
    if (department.parentId) return [{ id: department.id, label: department.parent?.nameEn ?? '', options: [{ id: department.id, label: department.nameEn }] }];
    const options = teams.map((t) => ({ id: t.id, label: t.nameEn }));
    if (department.id === keepId) options.unshift({ id: department.id, label: `${department.nameEn} (department)` });
    return options.length > 0 ? [{ id: department.id, label: department.nameEn, options }] : [];
  });
}

/** The office days ticked before a failed save, else the saved ones. */
function officeDaysOf(state: FormState, saved: number[]): Set<number> {
  if (!state.values) return new Set(saved);
  const typed = state.values.officeDays;
  return new Set((Array.isArray(typed) ? typed : typed ? [typed] : []).map(Number));
}

export function EmploymentFields({
  state,
  fid,
  pickers,
  employment,
}: {
  state: FormState;
  fid: (name: string) => string;
  pickers: EmploymentPickers;
  /** The employment being changed; none when adding one. An ended one has no status to choose (it follows why it ended). */
  employment?: Employment;
}) {
  const router = useRouter();
  // Kept in state: office days show only for Hybrid, and the job titles listed are the chosen team's.
  const [arrangement, setArrangement] = useState(() => valueOf(state, 'workArrangement', employment?.workArrangement ?? 'office'));
  const [jobTitleId, setJobTitleId] = useState(() => valueOf(state, 'jobTitleId', employment?.jobTitleId));
  // A job title without a department on the employment brings its own team, so it stays selected.
  const savedDepartmentId = employment?.departmentId ?? pickers.jobTitles.find((j) => j.id === employment?.jobTitleId)?.departmentId;
  const [departmentId, setDepartmentId] = useState(() => valueOf(state, 'departmentId', savedDepartmentId));

  // Job titles belong to teams: only the chosen team's are listed (and the current one, so it stays shown). A few
  // older job titles still sit directly in a department until HR moves them into a team.
  const titles = departmentId ? pickers.jobTitles.filter((j) => j.departmentId === departmentId || j.id === jobTitleId) : [];
  const chosen = pickers.departments.find((d) => d.id === departmentId);
  const noTitles = chosen !== undefined && titles.length === 0;

  // HR may add the team's first job title in another tab: coming back here lists it, keeping everything typed.
  useEffect(() => {
    if (!noTitles) return;
    const refresh = () => router.refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [noTitles, router]);

  const managerId = valueOf(state, 'managerId', employment?.managerId);
  // People who have left (or are not employed yet) can't be picked as a new manager, but a current choice stays visible.
  const managers = pickers.managers
    .filter((m) => EMPLOYED.includes(m.standing) || m.id === managerId)
    .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn));

  const officeDays = officeDaysOf(state, employment?.officeDays ?? []);

  function pickDepartment(id: string) {
    setDepartmentId(id);
    const title = pickers.jobTitles.find((j) => j.id === jobTitleId);
    if (title && title.departmentId !== id) setJobTitleId('');
  }

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('employmentType')} className="label">
            Employment type
          </label>
          <select
            id={fid('employmentType')}
            name="employmentType"
            required
            defaultValue={valueOf(state, 'employmentType', employment?.employmentType)}
            className="input"
          >
            <option value="">Choose a type</option>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {LABELS.employmentType[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fid('status')} className="label">
            Status
          </label>
          {employment?.endDate ? (
            // not sent: an ended employment's status follows why it ended
            <>
              <input
                id={fid('status')}
                value={LABELS.status[employment.status]}
                readOnly
                aria-describedby={fid('status-hint')}
                className="input bg-canvas text-muted"
              />
              <p id={fid('status-hint')} className="hint">
                Follows why the employment ended.
              </p>
            </>
          ) : (
            <select id={fid('status')} name="status" defaultValue={valueOf(state, 'status', employment?.status ?? 'probation')} className="input">
              {CURRENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LABELS.status[s]}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label htmlFor={fid('departmentId')} className="label">
            Team
          </label>
          {/* Teams under their department's name; typing a team's first letters still picks it. */}
          <select
            id={fid('departmentId')}
            name="departmentId"
            value={departmentId}
            onChange={(e) => pickDepartment(e.target.value)}
            className="input"
          >
            <option value="">No team</option>
            {teamGroups(pickers.departments, savedDepartmentId).map((g) => (
              <optgroup key={g.id} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fid('jobTitleId')} className="label">
            Job title
          </label>
          {/* Disabled (and so not sent) until a team with job titles is chosen: no job title is saved then. */}
          <select
            id={fid('jobTitleId')}
            name="jobTitleId"
            value={jobTitleId}
            onChange={(e) => setJobTitleId(e.target.value)}
            disabled={titles.length === 0}
            aria-describedby={noTitles ? fid('jobTitleId-hint') : undefined}
            className="input disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted"
          >
            <option value="">{departmentId ? 'No job title' : 'Choose a team first'}</option>
            {titles.map((j) => (
              <option key={j.id} value={j.id}>
                {j.grade ? `${j.titleEn} · ${j.grade.code}` : j.titleEn}
              </option>
            ))}
          </select>
          {noTitles && (
            <p id={fid('jobTitleId-hint')} className="hint">
              {chosen.parentId ? (
                <>
                  No job titles in this team yet.{' '}
                  <Link href={`/organization/departments/${chosen.id}`} target="_blank" rel="noopener">
                    Add one on the team&apos;s page
                  </Link>{' '}
                  (opens in a new tab).
                </>
              ) : (
                'No job titles directly in this department. Choose one of its teams.'
              )}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={fid('managerId')} className="label">
            Direct manager
          </label>
          <select id={fid('managerId')} name="managerId" defaultValue={managerId} className="input">
            <option value="">No direct manager</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullNameEn} · {m.employeeCode}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={fid('joinDate')} className="label">
            Join date
          </label>
          <DateInput id={fid('joinDate')} name="joinDate" required defaultValue={valueOf(state, 'joinDate', formatDate(employment?.joinDate))} />
        </div>
        <div>
          <label htmlFor={fid('probationEnd')} className="label">
            Probation end date
          </label>
          <DateInput
            id={fid('probationEnd')}
            name="probationEnd"
            aria-describedby={fid('probationEnd-hint')}
            defaultValue={valueOf(state, 'probationEnd', formatDate(employment?.probationEnd))}
          />
          <p id={fid('probationEnd-hint')} className="hint">
            Leave empty for the join date + {PROBATION_MONTHS} months.
          </p>
        </div>

        <div>
          <label htmlFor={fid('workArrangement')} className="label">
            Work arrangement
          </label>
          <select
            id={fid('workArrangement')}
            name="workArrangement"
            value={arrangement}
            onChange={(e) => setArrangement(e.target.value)}
            className="input"
          >
            {WORK_ARRANGEMENTS.map((w) => (
              <option key={w} value={w}>
                {LABELS.workArrangement[w]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fid('shiftId')} className="label">
            Shift
          </label>
          <select id={fid('shiftId')} name="shiftId" defaultValue={valueOf(state, 'shiftId', employment?.shiftId)} className="input">
            <option value="">No shift</option>
            {pickers.shifts.map((s) => (
              <option key={s.id} value={s.id}>
                Shift {s.code} · {formatTime(s.startTime)} – {formatTime(s.endTime)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {arrangement === 'hybrid' && (
        <fieldset>
          <legend className="label">Office days</legend>
          <div className="flex flex-wrap gap-2">
            {OFFICE_DAYS.map(([day, name]) => (
              <label
                key={day}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft"
              >
                <input type="checkbox" name="officeDays" value={day} defaultChecked={officeDays.has(day)} className="size-4 accent-accent" />
                {name}
              </label>
            ))}
          </div>
          <p className="hint">The days this employee comes to the office. Pick at least one.</p>
        </fieldset>
      )}
    </>
  );
}
