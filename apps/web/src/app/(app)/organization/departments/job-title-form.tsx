'use client';

import Link from 'next/link';
import { DepartmentOptions } from '@/components/department-options';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { Department, FormState, JobTitle } from '@/lib/types';

/**
 * A job title and its job description. It belongs to a department or to a team in one. That comes preselected from
 * the page the form was opened on; it can still be changed, which moves the job title there.
 */
export function JobTitleForm({
  action,
  departments,
  jobTitle,
  defaultDepartmentId,
  cancelHref,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  departments: Department[];
  jobTitle?: JobTitle;
  defaultDepartmentId?: string;
  cancelHref: string;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const duties = jobTitle?.duties.map((d) => d.duty).join('\n');

  return (
    <form {...form} className="card max-w-2xl space-y-5 p-6">
      <FormErrors errors={state.errors} />

      <div>
        <label htmlFor={fid('departmentId')} className="label">
          Department or team
        </label>
        <select
          id={fid('departmentId')}
          name="departmentId"
          required
          defaultValue={valueOf(state, 'departmentId', jobTitle?.departmentId ?? defaultDepartmentId)}
          className="input"
        >
          <option value="">Choose a department or team</option>
          <DepartmentOptions departments={departments} />
        </select>
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

      <div className="max-w-40">
        <label htmlFor={fid('grade')} className="label">
          Grade <span className="font-normal text-muted">· optional</span>
        </label>
        <input id={fid('grade')} name="grade" maxLength={20} placeholder="e.g. G5" defaultValue={valueOf(state, 'grade', jobTitle?.grade)} className="input" />
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
