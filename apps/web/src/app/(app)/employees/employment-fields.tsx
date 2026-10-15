'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, LABELS, PROBATION_MONTHS, WORK_ARRANGEMENTS } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { DepartmentOrTeamOptions } from '@/components/department-options';
import { valueOf } from '@/components/form';
import { formatDate, formatTime } from '@/lib/format';
import type { Department, EmployeeSummary, Employment, FormState, Grade, JobTitleSummary, Shift } from '@/lib/types';
import { gradeLabel, gradeRangeSentence, inGradeRange } from '../organization/grades/label';

// The fields of an employment, used by the Add employment and Edit employment pages.

export type EmploymentPickers = {
  departments: Department[];
  /** Each with the grades it allows (`minGrade`, `maxGrade`), for the Grade picker. */
  jobTitles: JobTitleSummary[];
  /** GET /grades, lowest first. */
  grades: Grade[];
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
  // Kept in state: office days show only for Hybrid, and the job titles listed are the chosen department's or team's.
  const [arrangement, setArrangement] = useState(() => valueOf(state, 'workArrangement', employment?.workArrangement ?? 'office'));
  const [type, setType] = useState(() => valueOf(state, 'employmentType', employment?.employmentType));
  const [jobTitleId, setJobTitleId] = useState(() => valueOf(state, 'jobTitleId', employment?.jobTitleId));
  // A job title without a department on the employment brings its own department or team, so it stays selected.
  const savedDepartmentId = employment?.departmentId ?? pickers.jobTitles.find((j) => j.id === employment?.jobTitleId)?.departmentId;
  const [departmentId, setDepartmentId] = useState(() => valueOf(state, 'departmentId', savedDepartmentId));
  // The person's own grade. A job title may allow only a range of grades (Account Manager: G3 to G6).
  const [gradeId, setGradeId] = useState(() => valueOf(state, 'gradeId', employment?.gradeId));
  const [clearedGrade, setClearedGrade] = useState<{ grade: Grade; title: string } | null>(null);

  // A job title belongs to a department itself (e.g. Head of Marketing) or to one of its teams (owner's decision, 15
  // October 2026): only the chosen department's own job titles, or the chosen team's, are listed (and the current one,
  // so it stays shown).
  const titles = departmentId ? pickers.jobTitles.filter((j) => j.departmentId === departmentId || j.id === jobTitleId) : [];
  const chosen = pickers.departments.find((d) => d.id === departmentId);
  const noTitles = chosen !== undefined && titles.length === 0;

  // Only the grades the chosen job title allows (all of them without one). A saved grade outside the range (in the
  // history, from before the range was narrowed) stays listed and flagged: the API keeps it while neither changes.
  const pickedTitle = titles.find((j) => j.id === jobTitleId);
  const grade = pickers.grades.find((g) => g.id === gradeId);
  const allowed = (g: Grade) => !pickedTitle || inGradeRange(g, pickedTitle);
  const grades = pickers.grades.filter((g) => allowed(g) || g.id === gradeId);
  const range = pickedTitle && gradeRangeSentence(pickedTitle.titleEn, pickedTitle);
  const outOfRange = grade && !allowed(grade);

  // HR may add the department's or team's first job title in another tab: coming back here lists it, keeping everything
  // typed.
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

  /** A grade the newly chosen job title doesn't allow is cleared, and the form says so. */
  function pickJobTitle(id: string) {
    setJobTitleId(id);
    const next = pickers.jobTitles.find((j) => j.id === id);
    if (next && grade && !inGradeRange(grade, next)) {
      setGradeId('');
      setClearedGrade({ grade, title: next.titleEn });
    } else {
      setClearedGrade(null);
    }
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
            onChange={(e) => setType(e.target.value)}
            aria-describedby={type === 'part_time' ? fid('employmentType-hint') : undefined}
            className="input"
          >
            <option value="">Choose a type</option>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {LABELS.employmentType[t]}
              </option>
            ))}
          </select>
          {/* the pay terms belong to the contract, not the employment (owner, 15 October 2026) */}
          {type === 'part_time' && (
            <p id={fid('employmentType-hint')} className="hint">
              Pay by the hour, hours a week and days a week are set on the contract: after saving, Contracts tab → New contract.
            </p>
          )}
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
            Department or team
          </label>
          {/* Each department as a group: the department itself first, then its teams; typing a team's first letters still picks it. */}
          <select
            id={fid('departmentId')}
            name="departmentId"
            value={departmentId}
            onChange={(e) => pickDepartment(e.target.value)}
            className="input"
          >
            <option value="">No department or team</option>
            <DepartmentOrTeamOptions departments={pickers.departments} />
          </select>
        </div>
        <div>
          <label htmlFor={fid('jobTitleId')} className="label">
            Job title
          </label>
          {/* Disabled (and so not sent) until a department or team with job titles is chosen: no job title is saved then. */}
          <select
            id={fid('jobTitleId')}
            name="jobTitleId"
            value={jobTitleId}
            onChange={(e) => pickJobTitle(e.target.value)}
            disabled={titles.length === 0}
            aria-describedby={noTitles ? fid('jobTitleId-hint') : undefined}
            className="input disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted"
          >
            <option value="">{departmentId ? 'No job title' : 'Choose a department or team first'}</option>
            {titles.map((j) => (
              <option key={j.id} value={j.id}>
                {j.titleEn}
              </option>
            ))}
          </select>
          {noTitles && (
            <p id={fid('jobTitleId-hint')} className="hint">
              {chosen.parentId ? 'No job titles in this team yet.' : 'No job titles of the department itself yet.'}{' '}
              <Link href={`/organization/departments/${chosen.id}`} target="_blank" rel="noopener">
                Add one on the {chosen.parentId ? 'team' : 'department'}&apos;s page
              </Link>{' '}
              (opens in a new tab){!chosen.parentId && chosen._count.children > 0 && ', or choose one of its teams'}.
            </p>
          )}
        </div>

        <div>
          <label htmlFor={fid('gradeId')} className="label">
            Grade
          </label>
          <select
            id={fid('gradeId')}
            name="gradeId"
            value={gradeId}
            onChange={(e) => {
              setGradeId(e.target.value);
              setClearedGrade(null);
            }}
            aria-describedby={range || outOfRange ? fid('gradeId-hint') : undefined}
            aria-invalid={outOfRange || undefined}
            className="input"
          >
            <option value="">No grade</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {gradeLabel(g)}
              </option>
            ))}
          </select>
          {(range || outOfRange) && (
            <p id={fid('gradeId-hint')} className={`hint ${outOfRange ? 'text-warn' : ''}`}>
              {outOfRange ? `${range} ${gradeLabel(grade)} was set before that, and can stay as it is.` : range}
            </p>
          )}
          <div role="status">
            {clearedGrade && (
              <p className="hint text-warn">
                {gradeLabel(clearedGrade.grade)} was cleared: {clearedGrade.title} doesn&apos;t take it. Choose a grade again.
              </p>
            )}
          </div>
        </div>

        <div>
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
          <select
            id={fid('shiftId')}
            name="shiftId"
            aria-describedby={fid('shiftId-hint')}
            defaultValue={valueOf(state, 'shiftId', employment?.shiftId)}
            className="input"
          >
            <option value="">No shift</option>
            {pickers.shifts.map((s) => (
              <option key={s.id} value={s.id}>
                Shift {s.code} · {formatTime(s.startTime)} – {formatTime(s.endTime)}
              </option>
            ))}
          </select>
          <p id={fid('shiftId-hint')} className="hint">
            No shift: no fixed days, e.g. a part-timer who comes in any 2 days a week.
          </p>
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
