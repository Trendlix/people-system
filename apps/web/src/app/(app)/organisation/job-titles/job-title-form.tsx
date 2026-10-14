'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, valueOf } from '@/components/form';
import type { Department, FormState, JobTitle } from '@/lib/types';

export function JobTitleForm({
  action,
  departments,
  jobTitle,
  defaultDepartmentId,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  departments: Department[];
  jobTitle?: JobTitle;
  defaultDepartmentId?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const duties = jobTitle?.duties.map((d) => d.duty).join('\n');

  return (
    <form action={formAction} className="card max-w-2xl space-y-5 p-6">
      <FormErrors errors={state.errors} />

      <div>
        <label htmlFor="departmentId" className="label">
          Department
        </label>
        <select
          id="departmentId"
          name="departmentId"
          required
          defaultValue={valueOf(state, 'departmentId', jobTitle?.departmentId ?? defaultDepartmentId)}
          className="input"
        >
          <option value="">Choose a department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nameEn}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="titleEn" className="label">
            Job title (English)
          </label>
          <input id="titleEn" name="titleEn" required maxLength={150} defaultValue={valueOf(state, 'titleEn', jobTitle?.titleEn)} className="input" />
        </div>
        <div>
          <label htmlFor="titleAr" className="label">
            Job title (Arabic) <span className="font-normal text-muted">· printed on contracts</span>
          </label>
          <input
            id="titleAr"
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
        <label htmlFor="grade" className="label">
          Grade <span className="font-normal text-muted">· optional</span>
        </label>
        <input id="grade" name="grade" maxLength={20} placeholder="e.g. G5" defaultValue={valueOf(state, 'grade', jobTitle?.grade)} className="input" />
      </div>

      <fieldset className="space-y-5 border-t border-line pt-5">
        <legend className="pr-2 font-semibold">Job description</legend>
        <div>
          <label htmlFor="jdPurpose" className="label">
            Purpose of the role
          </label>
          <textarea id="jdPurpose" name="jdPurpose" rows={3} maxLength={2000} defaultValue={valueOf(state, 'jdPurpose', jobTitle?.jdPurpose)} className="input" />
        </div>
        <div>
          <label htmlFor="duties" className="label">
            Duties & responsibilities
          </label>
          <textarea id="duties" name="duties" rows={7} defaultValue={valueOf(state, 'duties', duties)} className="input" />
          <p className="hint">One duty per line. KPIs will be linked to these duties later.</p>
        </div>
        <div>
          <label htmlFor="jdRequirements" className="label">
            Requirements
          </label>
          <textarea
            id="jdRequirements"
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
        <SubmitButton>{jobTitle ? 'Save changes' : 'Create job title'}</SubmitButton>
        <Link href="/organisation/job-titles" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
