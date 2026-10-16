'use client';

import { FormErrors, SubmitButton, useKeptForm } from '@/components/form';
import type { FormState } from '@/lib/types';
import { monthName } from './list';

/** Makes the month's run from the Overview (HR), then opens it, as New payroll run does. */
export function MakeRunButton({ action, month }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; month: string }) {
  const { state, pending, form } = useKeptForm(action);
  return (
    <form {...form} className="space-y-2">
      <FormErrors errors={state.errors} />
      <input type="hidden" name="month" value={month} />
      <SubmitButton busy={pending} pendingText="Making the run…">
        Make the {monthName(month)} run
      </SubmitButton>
    </form>
  );
}
