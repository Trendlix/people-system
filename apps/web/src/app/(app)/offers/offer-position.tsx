'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EMPLOYMENT_TYPES, LABELS, WORK_ARRANGEMENTS } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { DepartmentOrTeamOptions } from '@/components/department-options';
import { valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import { shiftTimesText } from '@/lib/shifts';
import type { FormState, Grade } from '@/lib/types';
import type { EmploymentPickers } from '../employees/employment-fields';
import { gradeLabel, gradeRangeSentence, inGradeRange } from '../organization/grades/label';
import type { OfferDefaults } from './form-body';

// The Position part of the offer form: the employment the candidate is offered, as the employment form picks it
// (employees/employment-fields.tsx): the department or team, then its job titles, then a grade within the title's range;
// the direct manager, the shift, the work arrangement (office days for Hybrid) and the expected join date. Accepting the
// offer makes the employment from these. Each field's box has an anchor (#field-<name>) for the offer page's list of
// what the template lacks.

const OFFICE_DAYS = [
  [0, 'Sun'],
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
] as const;

/** Only people with a current employment can be picked as the manager. */
const EMPLOYED: readonly string[] = ['active', 'probation', 'on_leave', 'notice_period'];

/** The office days ticked before a refused save, else the saved ones. */
function officeDaysOf(state: FormState, saved: number[]): Set<number> {
  if (!state.values) return new Set(saved);
  const typed = state.values.officeDays;
  return new Set((Array.isArray(typed) ? typed : typed ? [typed] : []).map(Number));
}

export function OfferPositionFields({
  state,
  fid,
  pickers,
  defaults,
}: {
  state: FormState;
  fid: (name: string) => string;
  pickers: EmploymentPickers;
  defaults: OfferDefaults;
}) {
  const router = useRouter();
  const [arrangement, setArrangement] = useState(() => valueOf(state, 'workArrangement', defaults.workArrangement));
  const [jobTitleId, setJobTitleId] = useState(() => valueOf(state, 'jobTitleId', defaults.jobTitleId));
  // a job title without a department on the offer brings its own department or team, so it stays selected
  const savedDepartmentId = defaults.departmentId || pickers.jobTitles.find((j) => j.id === defaults.jobTitleId)?.departmentId;
  const [departmentId, setDepartmentId] = useState(() => valueOf(state, 'departmentId', savedDepartmentId));
  const [gradeId, setGradeId] = useState(() => valueOf(state, 'gradeId', defaults.gradeId));
  const [clearedGrade, setClearedGrade] = useState<{ grade: Grade; title: string } | null>(null);

  // only the chosen department's own job titles, or the chosen team's (and the current one, so it stays shown)
  const titles = departmentId ? pickers.jobTitles.filter((j) => j.departmentId === departmentId || j.id === jobTitleId) : [];
  const chosen = pickers.departments.find((d) => d.id === departmentId);
  const noTitles = chosen !== undefined && titles.length === 0;

  // only the grades the chosen job title allows (all of them without one); a saved grade outside it stays, flagged
  const pickedTitle = titles.find((j) => j.id === jobTitleId);
  const grade = pickers.grades.find((g) => g.id === gradeId);
  const allowed = (g: Grade) => !pickedTitle || inGradeRange(g, pickedTitle);
  const grades = pickers.grades.filter((g) => allowed(g) || g.id === gradeId);
  const range = pickedTitle && gradeRangeSentence(pickedTitle.titleEn, pickedTitle);
  const outOfRange = grade && !allowed(grade);

  // HR may add the department's or team's first job title in another tab: coming back here lists it
  useEffect(() => {
    if (!noTitles) return;
    const refresh = () => router.refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [noTitles, router]);

  const managerId = valueOf(state, 'managerId', defaults.managerId);
  const managers = pickers.managers
    .filter((m) => EMPLOYED.includes(m.standing) || m.id === managerId)
    .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn));
  const officeDays = officeDaysOf(state, defaults.officeDays);

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
        <div id="field-employmentType" className="scroll-mt-6">
          <label htmlFor={fid('employmentType')} className="label">
            Employment type
          </label>
          <Select
            id={fid('employmentType')}
            name="employmentType"
            required
            aria-describedby={fid('employmentType-hint')}
            defaultValue={valueOf(state, 'employmentType', defaults.employmentType)}
            className="input"
          >
            <option value="">Choose a type</option>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {LABELS.employmentType[t]}
              </option>
            ))}
          </Select>
          <p id={fid('employmentType-hint')} className="hint">
            Picks the job offer template: each type has its own in Templates.
          </p>
        </div>
        <div id="field-joinDate" className="scroll-mt-6">
          <label htmlFor={fid('joinDate')} className="label">
            Join date
          </label>
          <DateInput
            id={fid('joinDate')}
            name="joinDate"
            required
            aria-describedby={fid('joinDate-hint')}
            defaultValue={valueOf(state, 'joinDate', formatDate(defaults.joinDate))}
          />
          <p id={fid('joinDate-hint')} className="hint">
            The expected first day. The contract starts on it.
          </p>
        </div>

        <div id="field-departmentId" className="scroll-mt-6">
          <label htmlFor={fid('departmentId')} className="label">
            Department or team
          </label>
          <Select id={fid('departmentId')} name="departmentId" value={departmentId} onChange={(e) => pickDepartment(e.target.value)} className="input">
            <option value="">No department or team</option>
            <DepartmentOrTeamOptions departments={pickers.departments} />
          </Select>
        </div>
        <div id="field-jobTitleId" className="scroll-mt-6">
          <label htmlFor={fid('jobTitleId')} className="label">
            Job title
          </label>
          {/* disabled (and so not sent) until a department or team with job titles is chosen */}
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

        <div id="field-gradeId" className="scroll-mt-6">
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
              {outOfRange ? `${range} ${gradeLabel(grade)} was set before that.` : range}
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
        <div id="field-managerId" className="scroll-mt-6">
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

        <div id="field-workArrangement" className="scroll-mt-6">
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
        <div id="field-shiftId" className="scroll-mt-6">
          <label htmlFor={fid('shiftId')} className="label">
            Shift
          </label>
          <Select id={fid('shiftId')} name="shiftId" defaultValue={valueOf(state, 'shiftId', defaults.shiftId)} className="input">
            <option value="">No shift</option>
            {pickers.shifts.map((s) => (
              <option key={s.id} value={s.id}>
                Shift {s.code} · {shiftTimesText(s)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {arrangement === 'hybrid' && (
        <fieldset id="field-officeDays" className="scroll-mt-6">
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
          <p className="hint">The days the candidate would come to the office. Pick at least one.</p>
        </fieldset>
      )}
    </>
  );
}
