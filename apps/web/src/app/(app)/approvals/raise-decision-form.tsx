'use client';

import { useActionState, useState } from 'react';
import { RAISE_DECISION_LABELS, RAISE_DECISIONS, type RaiseDecision, type RaiseRequester } from '@trendlix/shared';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';
import { choice } from '../employees/[id]/contracts/pay-fields';
import { commentReaders } from '../raise-requests/list';
import { FigureField } from '../raise-requests/request-forms';

const SUBMIT: Record<RaiseDecision, { label: string; busy: string }> = {
  approve: { label: 'Approve', busy: 'Approving…' },
  approve_other: { label: 'Approve with this raise', busy: 'Approving…' },
  reject: { label: 'Reject the raise', busy: 'Rejecting…' },
};

/**
 * The CEO's decision on a pay raise (owner's decisions, 16 October 2026: "HR, then the CEO"; 17 October 2026: "Approve -
 * Approve with another raise amount or percentge - Reject, and add a comment"): Approve it as it reached them, Approve
 * with another raise (an amount or a percent over the pay before it: its pay is changed to that and approved at once),
 * or Reject it (the draft goes, and the raise request it came from is rejected with it), always with a comment; Return
 * to HR stays a secondary action, with the comment as what HR should change. The choice is sent as `decision`, Return to
 * HR as `intent`; it asks before approving or rejecting; a refusal shows on the card. Approvals and the raise card in
 * the Contract section both use it.
 */
export function RaiseDecisionForm({
  action,
  confirmApprove,
  name,
  previousGross = null,
  requester = null,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** The question asked before approving it as it is. */
  confirmApprove: string;
  /** Whose raise it is, for the confirmations. */
  name: string;
  /** The gross before it, for what another raise comes to. */
  previousGross?: number | null;
  /** Who asked for the raise it came from, to say who reads the comment; null: a raise HR entered on its own. */
  requester?: RaiseRequester | null;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [decision, setDecision] = useState<RaiseDecision | ''>(() => valueOf(state, 'decision') as RaiseDecision | '');
  const [pressed, setPressed] = useState<'decide' | 'return' | null>(null);
  const fid = useFieldIds();
  const submit = decision ? SUBMIT[decision] : null;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const button = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const returning = button?.name === 'intent' && button.value === 'return';
        const question = returning
          ? null
          : decision === 'approve'
            ? confirmApprove
            : decision === 'approve_other'
              ? `Approve ${name}'s raise with the raise you entered? Its pay is changed to it, and HR then has it signed.`
              : decision === 'reject'
                ? `Reject ${name}'s raise? The draft goes, and so does the raise request it came from, if any.`
                : null;
        if (question && !window.confirm(question)) {
          e.preventDefault();
          return;
        }
        setPressed(returning ? 'return' : 'decide');
      }}
      className="mt-4 space-y-4 border-t border-line-soft pt-4"
    >
      <FormErrors errors={state.errors} />
      <fieldset>
        <legend className="label">Your decision</legend>
        <div className="flex flex-wrap gap-2">
          {RAISE_DECISIONS.map((d) => (
            <label key={d} className={choice}>
              <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="size-4 accent-accent" />
              {RAISE_DECISION_LABELS[d]}
            </label>
          ))}
        </div>
      </fieldset>
      {decision === 'approve_other' && (
        <FigureField
          fid={fid}
          state={state}
          gross={previousGross}
          label="The raise"
          hint="Over the pay before it: an amount in EGP added to the monthly gross, or a percent of it. The allowances stay as they are."
          required
        />
      )}
      <div>
        <label htmlFor={fid('comment')} className="label">
          Comment
        </label>
        <textarea
          id={fid('comment')}
          name="comment"
          rows={2}
          required
          maxLength={1000}
          aria-describedby={fid('comment-hint')}
          defaultValue={valueOf(state, 'comment')}
          className="input"
        />
        <p id={fid('comment-hint')} className="hint">
          {commentReaders('decision', requester)} Returned to HR, HR alone sees it.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={`btn ${decision === 'reject' ? 'btn-danger' : 'btn-primary'}`}>
          {pending && pressed === 'decide' ? (submit?.busy ?? 'Saving…') : (submit?.label ?? 'Save the decision')}
        </button>
        <button type="submit" name="intent" value="return" formNoValidate disabled={pending} className="btn btn-secondary">
          {pending && pressed === 'return' ? 'Returning…' : 'Return to HR'}
        </button>
      </div>
    </form>
  );
}
