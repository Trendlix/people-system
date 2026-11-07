'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, SubmitButton } from '@/components/form';
import type { FormState } from '@/lib/types';
import { setUpSampleAccount } from './actions';
import { SAMPLE_ACCOUNT_TEXT, SAMPLE_REFRESH_CONFIRM } from './test-account';

// The Sample account form on Employees → Test accounts (owner, 7 November 2026: "the test account shows nothing after
// the login, allow apple testers to see some dummy data"): the email of the account the reviewers sign in with; the API
// makes it a test profile with sample data, or makes its data again. HR and Super Admins (the page decides).

export function SampleAccountForm() {
  const [state, formAction] = useActionState(setUpSampleAccount, {});
  const made = typeof state.values?.employeeId === 'string' ? state.values.employeeId : null;
  return (
    <form action={formAction} className="space-y-3 border-b border-line p-4">
      <h2 className="font-semibold">Sample account for app reviewers</h2>
      <p className="text-sm text-muted">{SAMPLE_ACCOUNT_TEXT}</p>
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="sample-email" className="label">
            The reviewers’ sign-in email
          </label>
          <input
            id="sample-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="testing@trendlix.com"
            defaultValue={made ? '' : String(state.values?.email ?? '')}
            className="input"
          />
        </div>
        <SubmitButton pendingText="Setting up…">Set up</SubmitButton>
      </div>
      {state.message && (
        <p role="status" className="text-sm text-ok">
          {state.message} {made && <Link href={`/employees/${made}`}>Open the profile</Link>}
        </p>
      )}
    </form>
  );
}

/** Make its sample data again, on a test profile's Test Account section: asks first, then says what was made. */
export function SampleRefreshButton({ action }: { action: () => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(SAMPLE_REFRESH_CONFIRM)) e.preventDefault();
      }}
      className="space-y-1"
    >
      <button type="submit" disabled={pending} className="btn btn-secondary min-h-9 px-3">
        {pending ? 'Making it…' : 'Make its sample data again'}
      </button>
      {state.errors && (
        <p role="alert" className="max-w-sm text-xs text-danger">
          {state.errors.join(' ')}
        </p>
      )}
      {state.message && (
        <p role="status" className="max-w-sm text-xs text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}
