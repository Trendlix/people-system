'use client';

import Link from 'next/link';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm } from '@/components/form';
import type { EmployeeProfile, FormState } from '@/lib/types';
import { PersonalFields, type Part } from '../../../personal-fields';

/** The profile's fields, or one `part` of them (the Personal Details page: `profile`; the Education page: `education`). */
export function PersonalForm({
  action,
  employee,
  part,
  cancelHref,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employee: EmployeeProfile;
  part?: Part;
  cancelHref: string;
}) {
  // Kept form: a refused save leaves the selects (gender, marital status…) as they were chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} className="card max-w-3xl space-y-8 p-6">
      <FormErrors errors={state.errors} />

      <PersonalFields state={state} fid={fid} employee={employee} part={part} />

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>Save changes</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
