'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EMPLOYMENT_TYPES, LABELS, PROBATION_MONTHS, WORK_ARRANGEMENTS } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { DepartmentOrTeamOptions } from '@/components/department-options';
import { valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate, formatTime } from '@/lib/format';
import type { Department, EmployeeSummary, Employment, FormState, Grade, JobTitleSummary, Shift } from '@/lib/types';
import { gradeLabel, gradeRangeSentence, inGradeRange } from '../organization/grades/label';
import { statusField } from './employment-status';

// The fields of an employment, used by the Add employment page (above the first contract's terms: hiring in one form,
// owner's decision, 16 October 2026) and the Edit employment page.

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
  contractBelow = false,
}: {
  state: FormState;
  fid: (name: string) => string;
  pickers: EmploymentPickers;
  /** Hiring in one form: the first contract's terms follow in the same form. */
  contractBelow?: boolean;
  /**
   * The employment being changed; none when adding one. HR chooses Active or On leave only; a new one's status, and
   * Probation and Notice period, are the system's, and an ended one's follows why it ended (employment-status.ts).
   */
  employment?: Employment;
}) {
  const router = useRouter();
  const status = statusField(employment);
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
          <Select
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
          </Select>
          {/* the pay terms belong to the contract, not the employment (owner, 15 October 2026) */}
          {type === 'part_time' && (
            <p id={fid('employmentType-hint')} className="hint">
              {contractBelow
                ? "Pay by the hour, hours a week and days a week are the contract's terms, below."
                : "Pay by the hour, hours a week and days a week are the contract's terms: a new version of it, on the Employment tab."}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={fid('status')} className="label">
            Status
          </label>
          {status.kind === 'choose' ? (
            <Select id={fid('status')} name="status" defaultValue={valueOf(state, 'status', employment?.status)} className="input">
              {status.options.map((s) => (
                <option key={s} value={s}>
                  {LABELS.status[s]}
                </option>
              ))}
            </Select>
          ) : (
            // not sent (no name): the system sets it, or for an ended employment why it ended
            <>
              <input
                id={fid('status')}
                value={status.value}
                readOnly
                aria-describedby={fid('status-hint')}
                className="input bg-canvas text-muted"
              />
              <p id={fid('status-hint')} className="hint">
                {status.hint}
              </p>
            </>
          )}
        </div>

        <div>
          <label htmlFor={fid('departmentId')} className="label">
            Department or team
          </label>
          {/* Each department as a group: the department itself first, then its teams; typing a team's first letters still picks it. */}
          <Select
            id={fid('departmentId')}
            name="departmentId"
            value={departmentId}
            onChange={(e) => pickDepartment(e.target.value)}
            className="input"
          >
            <option value="">No department or team</option>
            <DepartmentOrTeamOptions departments={pickers.departments} />
          </Select>
        </div>
        <div>
          <label htmlFor={fid('jobTitleId')} className="label">
            Job title
          </label>
          {/* Disabled (and so not sent) until a department or team with job titles is chosen: no job title is saved then. */}
          <Select
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
          </Select>
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
          <Select
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
          </Select>
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
          <Select id={fid('managerId')} name="managerId" defaultValue={managerId} className="input">
            <option value="">No direct manager</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullNameEn} · {m.employeeCode}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor={fid('joinDate')} className="label">
            Join date
          </label>
          <DateInput
            id={fid('joinDate')}
            name="joinDate"
            required
            aria-describedby={fid('joinDate-hint')}
            defaultValue={valueOf(state, 'joinDate', formatDate(employment?.joinDate))}
          />
          {/* the probation end is worked out, never typed (owner, 15 October 2026) */}
          <p id={fid('joinDate-hint')} className="hint">
            {contractBelow
              ? "The contract starts on it, and its probation, set below, runs from it: at most 3 months, and none for someone who worked here before (Labour Law Art. 90)."
              : `Probation is worked out from it: ${PROBATION_MONTHS} months, or none for someone who worked here before (Labour Law Art. 90). Once the first contract is drafted, its probation applies.`}
            {employment?.probationEnd && ` Probation ends ${formatDate(employment.probationEnd)}.`}
          </p>
        </div>

        <div>
          <label htmlFor={fid('workArrangement')} className="label">
            Work arrangement
          </label>
          <Select
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
          </Select>
        </div>
        <div>
          <label htmlFor={fid('shiftId')} className="label">
            Shift
          </label>
          <Select
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
          </Select>
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
