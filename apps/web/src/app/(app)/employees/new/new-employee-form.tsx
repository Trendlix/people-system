'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';
import { createEmployee } from '../actions';
import { EmploymentFields, type EmploymentPickers } from '../employment-fields';

export function NewEmployeeForm({ pickers }: { pickers: EmploymentPickers }) {
  const [state, formAction] = useActionState(createEmployee, {} as FormState);
  const fid = useFieldIds();

  return (
    <form action={formAction} className="card max-w-3xl space-y-8 p-6">
      <FormErrors errors={state.errors} />

      <fieldset className="space-y-5">
        <legend className="font-semibold">Employee</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('fullNameEn')} className="label">
              Full name (English)
            </label>
            <input id={fid('fullNameEn')} name="fullNameEn" required maxLength={150} defaultValue={valueOf(state, 'fullNameEn')} className="input" />
          </div>
          <div>
            <label htmlFor={fid('fullNameAr')} className="label">
              Full name (Arabic) <span className="font-normal text-muted">· printed on contracts</span>
            </label>
            <input
              id={fid('fullNameAr')}
              name="fullNameAr"
              lang="ar"
              dir="rtl"
              required
              maxLength={150}
              defaultValue={valueOf(state, 'fullNameAr')}
              className="input"
            />
          </div>
          <div>
            <label htmlFor={fid('employeeCode')} className="label">
              Employee code <span className="font-normal text-muted">· optional</span>
            </label>
            <input
              id={fid('employeeCode')}
              name="employeeCode"
              maxLength={20}
              placeholder="EMP-0000"
              aria-describedby={fid('employeeCode-hint')}
              defaultValue={valueOf(state, 'employeeCode')}
              className="input uppercase"
            />
            <p id={fid('employeeCode-hint')} className="hint">
              Leave empty to give the next number automatically.
            </p>
          </div>
          <div>
            <label htmlFor={fid('workEmail')} className="label">
              Work email
            </label>
            <input
              id={fid('workEmail')}
              name="workEmail"
              type="email"
              maxLength={254}
              aria-describedby={fid('workEmail-hint')}
              defaultValue={valueOf(state, 'workEmail')}
              className="input"
            />
            <p id={fid('workEmail-hint')} className="hint">
              A sign-in account with this email is linked to this employee.
            </p>
          </div>
          <div>
            <label htmlFor={fid('mobile')} className="label">
              Mobile
            </label>
            <input id={fid('mobile')} name="mobile" type="tel" maxLength={30} defaultValue={valueOf(state, 'mobile')} className="input" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-semibold">Employment</legend>
        <EmploymentFields state={state} fid={fid} pickers={pickers} />
      </fieldset>

      <p className="text-sm text-muted">Personal details, education, national ID and bank details can be added on the profile once it is created.</p>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton>Add employee</SubmitButton>
        <Link href="/employees" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
