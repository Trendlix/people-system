'use client';

import Link from 'next/link';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm } from '@/components/form';
import type { EmployeeProfile, FormState } from '@/lib/types';
import { LeaveFactsFields } from '../../../leave-fields';
import { PersonalFields, type Part } from '../../../personal-fields';

/** The profile's fields, or one `part` of them (the Personal Details page: `profile`; the Education page: `education`). */
export function PersonalForm({
  action,
  employee,
  part,
  emailDomain,
  cancelHref,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employee: EmployeeProfile;
  part?: Part;
  /** The company's work email domain, for the work email (on the Personal Details page). */
  emailDomain?: string | null;
  cancelHref: string;
}) {
  // Kept form: a refused save leaves the selects (gender, marital status…) as they were chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} className="card max-w-3xl space-y-8 p-6">
      <FormErrors errors={state.errors} />

      <PersonalFields state={state} fid={fid} employee={employee} part={part} emailDomain={emailDomain} />
      {/* the annual leave's facts on the profile (18 October 2026), from an API that has them */}
      {part === 'profile' && employee.disability !== undefined && <LeaveFactsFields state={state} fid={fid} employee={employee} />}

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>Save changes</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
