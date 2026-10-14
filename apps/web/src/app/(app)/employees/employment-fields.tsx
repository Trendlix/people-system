'use client';

import { useState } from 'react';
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, LABELS, PROBATION_MONTHS, WORK_ARRANGEMENTS } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { valueOf } from '@/components/form';
import { formatDate, formatTime } from '@/lib/format';
import type { Department, EmployeeProfile, EmployeeSummary, FormState, JobTitleSummary, Shift } from '@/lib/types';

// The Employment fields, used by the new-employee form and the Employment edit page.

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

const LEFT: readonly string[] = ['resigned', 'terminated'];

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
  employee,
}: {
  state: FormState;
  fid: (name: string) => string;
  pickers: EmploymentPickers;
  employee?: EmployeeProfile;
}) {
  // Kept in state: office days show only for Hybrid, and the department follows the chosen job title.
  const [arrangement, setArrangement] = useState(() => valueOf(state, 'workArrangement', employee?.workArrangement ?? 'office'));
  const [departmentId, setDepartmentId] = useState(() => valueOf(state, 'departmentId', employee?.departmentId));
  const [jobTitleId, setJobTitleId] = useState(() => valueOf(state, 'jobTitleId', employee?.jobTitleId));

  const titlesByDepartment = pickers.departments
    .map((d) => ({ department: d, titles: pickers.jobTitles.filter((j) => j.departmentId === d.id) }))
    .filter((g) => g.titles.length > 0);

  const managerId = valueOf(state, 'managerId', employee?.managerId);
  // People who have left can't be picked as a new manager, but a current choice stays visible.
  const managers = pickers.managers
    .filter((m) => !LEFT.includes(m.status) || m.id === managerId)
    .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn));

  const officeDays = officeDaysOf(state, employee?.officeDays ?? []);

  function pickJobTitle(id: string) {
    setJobTitleId(id);
    const title = pickers.jobTitles.find((j) => j.id === id);
    if (title) setDepartmentId(title.departmentId);
  }

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
            defaultValue={valueOf(state, 'employmentType', employee?.employmentType)}
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
          <select id={fid('status')} name="status" defaultValue={valueOf(state, 'status', employee?.status ?? 'probation')} className="input">
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LABELS.status[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={fid('departmentId')} className="label">
            Department
          </label>
          <select
            id={fid('departmentId')}
            name="departmentId"
            value={departmentId}
            onChange={(e) => pickDepartment(e.target.value)}
            className="input"
          >
            <option value="">No department</option>
            {pickers.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameEn}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fid('jobTitleId')} className="label">
            Job title
          </label>
          <select
            id={fid('jobTitleId')}
            name="jobTitleId"
            value={jobTitleId}
            onChange={(e) => pickJobTitle(e.target.value)}
            aria-describedby={fid('jobTitleId-hint')}
            className="input"
          >
            <option value="">No job title</option>
            {titlesByDepartment.map((g) => (
              <optgroup key={g.department.id} label={g.department.nameEn}>
                {g.titles.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.grade ? `${j.titleEn} (${j.grade})` : j.titleEn}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p id={fid('jobTitleId-hint')} className="hint">
            Choosing a job title also sets its department.
          </p>
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
          <DateInput id={fid('joinDate')} name="joinDate" required defaultValue={valueOf(state, 'joinDate', formatDate(employee?.joinDate))} />
        </div>
        <div>
          <label htmlFor={fid('probationEnd')} className="label">
            Probation end date
          </label>
          <DateInput
            id={fid('probationEnd')}
            name="probationEnd"
            aria-describedby={fid('probationEnd-hint')}
            defaultValue={valueOf(state, 'probationEnd', formatDate(employee?.probationEnd))}
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
          <select id={fid('shiftId')} name="shiftId" defaultValue={valueOf(state, 'shiftId', employee?.shiftId)} className="input">
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
