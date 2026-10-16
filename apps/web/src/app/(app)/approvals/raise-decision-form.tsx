'use client';

import { useActionState, useState } from 'react';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

type Decision = 'approve' | 'return' | 'decline';

const BUSY: Record<Decision, string> = { approve: 'Approving…', return: 'Returning…', decline: 'Declining…' };

/**
 * The CEO's decision on a pay raise (owner's decisions, 16 October 2026: "HR, then the CEO"): Approve (asks first),
 * Return to HR or Decline, each of those two with a reason (HR, the employee's manager and the employee see a decline's;
 * a return's goes to HR). The button pressed is sent as `decision`; a refusal shows on the card.
 */
export function RaiseDecisionForm({
  action,
  confirmApprove,
  name,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** The question asked before approving. */
  confirmApprove: string;
  /** Whose raise it is, for the confirmation of a decline. */
  name: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [pressed, setPressed] = useState<Decision | null>(null);
  const fid = useFieldIds();

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const button = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const decision: Decision = button?.value === 'return' ? 'return' : button?.value === 'decline' ? 'decline' : 'approve';
        const question =
          decision === 'approve'
            ? confirmApprove
            : decision === 'decline'
              ? `Decline ${name}'s raise? The draft goes, and so does the raise request it came from, if any.`
              : null;
        if (question && !window.confirm(question)) {
          e.preventDefault();
          return;
        }
        setPressed(decision);
      }}
      className="mt-4 space-y-3 border-t border-line-soft pt-4"
    >
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('reason')} className="label">
          Reason <span className="font-normal text-muted">· required to return or decline</span>
        </label>
        <textarea id={fid('reason')} name="reason" rows={2} maxLength={1000} defaultValue={valueOf(state, 'reason')} className="input" />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" name="decision" value="approve" disabled={pending} className="btn btn-primary">
          {pending && pressed === 'approve' ? BUSY.approve : 'Approve'}
        </button>
        <button type="submit" name="decision" value="return" disabled={pending} className="btn btn-secondary">
          {pending && pressed === 'return' ? BUSY.return : 'Return to HR'}
        </button>
        <button type="submit" name="decision" value="decline" disabled={pending} className="btn btn-danger">
          {pending && pressed === 'decline' ? BUSY.decline : 'Decline'}
        </button>
      </div>
    </form>
  );
}
