'use client';

import { useActionState } from 'react';
import { FormErrors } from '@/components/form';
import type { FormState } from '@/lib/types';

// HR's "Open this month's scorecards now" (owner's brief, 21 October 2026: "A scheduler tick … plus a "Open this
// month's scorecards now" for HR"): opens last month's scorecards for everyone whose job title has a published template
// and who has none yet, rather than waiting for the 1st, and says how many opened. Asks first: each person is told.

export function OpenScorecardsForm({ action, monthName }: { action: () => Promise<FormState>; monthName: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Open ${monthName}'s scorecards now? Everyone whose job title has a published template gets theirs, and is told to rate themself.`)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Opening…' : `Open ${monthName}'s scorecards now`}
      </button>
      <FormErrors errors={state.errors} />
      {state.message && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}
