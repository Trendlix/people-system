'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, valueOf } from '@/components/form';
import type { Department, FormState } from '@/lib/types';

export function DepartmentForm({
  action,
  department,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  department?: Department;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="card max-w-xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor="nameEn" className="label">
          Name (English)
        </label>
        <input id="nameEn" name="nameEn" required maxLength={100} defaultValue={valueOf(state, 'nameEn', department?.nameEn)} className="input" />
      </div>
      <div>
        <label htmlFor="nameAr" className="label">
          Name (Arabic) <span className="font-normal text-muted">· optional</span>
        </label>
        <input
          id="nameAr"
          name="nameAr"
          lang="ar"
          dir="rtl"
          maxLength={100}
          defaultValue={valueOf(state, 'nameAr', department?.nameAr)}
          className="input"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton>{department ? 'Save changes' : 'Create department'}</SubmitButton>
        <Link href="/organisation/departments" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
