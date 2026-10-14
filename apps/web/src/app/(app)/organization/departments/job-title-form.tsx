'use client';

import Link from 'next/link';
import { TeamOptions } from '@/components/department-options';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { Department, FormState, Grade, JobTitle } from '@/lib/types';
import { gradeLabel } from '../grades/label';

/**
 * A job title and its job description. It belongs to a team (Department → Team → Job title), which comes preselected
 * from the team page the form was opened on; choosing another one moves the job title there.
 * `departments`: every department and team (GET /departments), for the team picker. `grades`: GET /grades.
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

      <div className="max-w-xs">
        <label htmlFor={fid('gradeId')} className="label">
          Grade
        </label>
        <select id={fid('gradeId')} name="gradeId" defaultValue={valueOf(state, 'gradeId', jobTitle?.grade?.id)} className="input">
          <option value="">No grade</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {gradeLabel(g)}
            </option>
          ))}
        </select>
      </div>

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
