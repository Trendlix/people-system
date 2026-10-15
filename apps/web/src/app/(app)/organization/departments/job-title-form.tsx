'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TeamOptions } from '@/components/department-options';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { Department, FormState, Grade, JobTitle } from '@/lib/types';
import { gradeLabel } from '../grades/label';

/**
 * A job title and its job description. It belongs to a team (Department → Team → Job title), which comes preselected
 * from the team page the form was opened on; choosing another one moves the job title there.
 * `departments`: every department and team (GET /departments), for the team picker. `grades`: GET /grades, lowest first.
 *
 * A job title has no grade of its own (owner's decision: a junior and a senior account manager are both Account
 * Managers, with different grades). It may limit the grades people with it can have to a range, either end of which
 * can be left open; each employment then has the person's own grade, in that range.
 */
export function JobTitleForm({
  action,
  departments,
  grades,
  jobTitle,
  defaultTeamId,
  cancelHref,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  departments: Department[];
  grades: Grade[];
  jobTitle?: JobTitle;
  defaultTeamId?: string;
  cancelHref: string;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const duties = jobTitle?.duties.map((d) => d.duty).join('\n');
  // The range's ends, kept in state so "To" only offers grades from "From" up.
  const [minId, setMinId] = useState(() => valueOf(state, 'minGradeId', jobTitle?.minGradeId));
  const [maxId, setMaxId] = useState(() => valueOf(state, 'maxGradeId', jobTitle?.maxGradeId));
  const [clearedMax, setClearedMax] = useState<Grade | null>(null);
  const minGrade = grades.find((g) => g.id === minId);
  // (a saved choice stays listed, so the API can say what is wrong with it)
  const highest = grades.filter((g) => !minGrade || g.rank >= minGrade.rank || g.id === maxId);
  const hasTeams = departments.some((d) => d.parentId);
  // A job title from before teams may sit directly in a department: no team is chosen until one is picked for it.
  const inDepartment = jobTitle && !jobTitle.department.parent ? jobTitle.department : null;
  const savedTeam = jobTitle ? (inDepartment ? '' : jobTitle.departmentId) : defaultTeamId;
  const teamHint = inDepartment
    ? `This job title is directly in the ${inDepartment.nameEn} department, from before teams. Choose a team for it.`
    : !hasTeams
      ? 'No teams yet. Add a team to a department first (Departments & Job Titles, Add team).'
      : null;

  return (
    <form {...form} className="card max-w-2xl space-y-5 p-6">
      <FormErrors errors={state.errors} />

      <div>
        <label htmlFor={fid('departmentId')} className="label">
          Team
        </label>
        <select
          id={fid('departmentId')}
          name="departmentId"
          required
          defaultValue={valueOf(state, 'departmentId', savedTeam)}
          aria-describedby={teamHint ? fid('departmentId-hint') : undefined}
          className="input"
        >
          <option value="">Choose a team</option>
          <TeamOptions departments={departments} />
        </select>
        {teamHint && (
          <p id={fid('departmentId-hint')} className={`hint ${inDepartment ? 'text-warn' : ''}`}>
            {teamHint}
          </p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('titleEn')} className="label">
            Job title (English)
          </label>
          <input id={fid('titleEn')} name="titleEn" required maxLength={150} defaultValue={valueOf(state, 'titleEn', jobTitle?.titleEn)} className="input" />
        </div>
        <div>
          <label htmlFor={fid('titleAr')} className="label">
            Job title (Arabic) <span className="font-normal text-muted">· printed on contracts</span>
          </label>
          <input
            id={fid('titleAr')}
            name="titleAr"
            lang="ar"
            dir="rtl"
            maxLength={150}
            defaultValue={valueOf(state, 'titleAr', jobTitle?.titleAr)}
            className="input"
          />
        </div>
      </div>

      <fieldset aria-describedby={fid('grades-hint')} className="max-w-lg">
        <legend className="label">Grades</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={fid('minGradeId')} className="mb-1 block text-sm text-muted">
              From
            </label>
            <select
              id={fid('minGradeId')}
              name="minGradeId"
              value={minId}
              onChange={(e) => {
                const from = grades.find((g) => g.id === e.target.value);
                const to = grades.find((g) => g.id === maxId);
                setMinId(e.target.value);
                // a highest grade below the new lowest one would be the wrong way round: let it go, and say so
                if (from && to && to.rank < from.rank) {
                  setMaxId('');
                  setClearedMax(to);
                } else {
                  setClearedMax(null);
                }
              }}
              className="input"
            >
              <option value="">Any</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {gradeLabel(g)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={fid('maxGradeId')} className="mb-1 block text-sm text-muted">
              To
            </label>
            <select
              id={fid('maxGradeId')}
              name="maxGradeId"
              value={maxId}
              onChange={(e) => {
                setMaxId(e.target.value);
                setClearedMax(null);
              }}
              className="input"
            >
              <option value="">No limit</option>
              {highest.map((g) => (
                <option key={g.id} value={g.id}>
                  {gradeLabel(g)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p id={fid('grades-hint')} className="hint">
          The grades people with this title can have, e.g. G3 to G6 for Account Manager. Leave empty to allow any grade.
        </p>
        <div role="status">
          {clearedMax && minGrade && (
            <p className="hint text-warn">
              &ldquo;To&rdquo; was {gradeLabel(clearedMax)}, below {gradeLabel(minGrade)}, so it was cleared. Choose the highest grade again.
            </p>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-5 border-t border-line pt-5">
        <legend className="pr-2 font-semibold">Job Description</legend>
        <div>
          <label htmlFor={fid('jdPurpose')} className="label">
            Purpose of the role
          </label>
          <textarea id={fid('jdPurpose')} name="jdPurpose" rows={3} maxLength={2000} defaultValue={valueOf(state, 'jdPurpose', jobTitle?.jdPurpose)} className="input" />
        </div>
        <div>
          <label htmlFor={fid('duties')} className="label">
            Duties & responsibilities
          </label>
          <textarea id={fid('duties')} name="duties" rows={7} defaultValue={valueOf(state, 'duties', duties)} className="input" />
          <p className="hint">One duty per line. KPIs will be linked to these duties later.</p>
        </div>
        <div>
          <label htmlFor={fid('jdRequirements')} className="label">
            Requirements
          </label>
          <textarea
            id={fid('jdRequirements')}
            name="jdRequirements"
            rows={4}
            maxLength={4000}
            defaultValue={valueOf(state, 'jdRequirements', jobTitle?.jdRequirements)}
            className="input"
          />
        </div>
        {jobTitle && (
          <p className="hint">
            Job description version {jobTitle.jdVersion}. Changing the purpose, duties or requirements creates version {jobTitle.jdVersion + 1}.
          </p>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>{jobTitle ? 'Save changes' : 'Create job title'}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
