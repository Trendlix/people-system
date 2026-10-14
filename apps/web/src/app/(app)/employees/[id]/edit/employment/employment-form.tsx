'use client';

import Link from 'next/link';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile, FormState } from '@/lib/types';
import { EmploymentFields, type EmploymentPickers } from '../../../employment-fields';

export function EmploymentForm({
  action,
  employee,
  pickers,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employee: EmployeeProfile;
  pickers: EmploymentPickers;
}) {
  // Kept form: a refused save leaves the selects (type, status, manager, shift…) as they were chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} className="card max-w-3xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <EmploymentFields state={state} fid={fid} pickers={pickers} employee={employee} />
      <div className="max-w-64">
        <label htmlFor={fid('jdAcknowledgedAt')} className="label">
          Job description acknowledged on
        </label>
        <DateInput
          id={fid('jdAcknowledgedAt')}
          name="jdAcknowledgedAt"
          aria-describedby={fid('jdAcknowledgedAt-hint')}
          defaultValue={valueOf(state, 'jdAcknowledgedAt', formatDate(employee.jdAcknowledgedAt))}
        />
        <p id={fid('jdAcknowledgedAt-hint')} className="hint">
          The date the employee signed their job description{employee.jobTitle ? ` (version ${employee.jobTitle.jdVersion})` : ''}.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>Save changes</SubmitButton>
        <Link href={`/employees/${employee.id}`} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
