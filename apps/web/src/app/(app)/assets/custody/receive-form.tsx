'use client';

import { CUSTODY_TEXT_LIMITS, RETURN_CONDITION_HINTS, RETURN_CONDITION_LABELS, RETURN_CONDITIONS, type CustodyItemView } from '@trendlix/shared';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';
import { conditionField, returnNotesField } from '../custody';

// Receive back (Assets step 3; spec §6.4), for a custodian or a manager: each item still out with how it came back,
// good (available again), damaged (under repair, with an entry in its maintenance log: "Returned damaged on CUS-xxxx by
// {name}") or missing (lost), and notes; an item left as "Still out" stays with the person. Who received it and when are
// kept; the record is partly returned, or closed once everything is back. The API checks it again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function ReceiveForm({ action, items }: { action: Action; items: CustodyItemView[] }) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} aria-label="Receive back" className="space-y-4">
      <FormErrors errors={state.errors} />
      {state.message && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {state.message}
        </p>
      )}
      <ul className="divide-y divide-line-soft rounded-lg border border-line">
        {items.map((i) => (
          <li key={i.id} className="space-y-3 p-3">
            <p className="font-semibold break-words">
              {i.asset.name} <span className="font-mono text-xs font-normal text-muted">{i.asset.code}</span>
            </p>
            <fieldset>
              <legend className="sr-only">How {i.asset.code} came back</legend>
              <div className="flex flex-wrap gap-2 text-sm">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3">
                  <input type="radio" name={conditionField(i.id)} value="" defaultChecked={valueOf(state, conditionField(i.id), '') === ''} />
                  Still out
                </label>
                {RETURN_CONDITIONS.map((c) => (
                  <label key={c} title={RETURN_CONDITION_HINTS[c]} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3">
                    <input type="radio" name={conditionField(i.id)} value={c} defaultChecked={valueOf(state, conditionField(i.id), '') === c} />
                    {RETURN_CONDITION_LABELS[c]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor={fid(returnNotesField(i.id))} className="label">
                Notes <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id={fid(returnNotesField(i.id))}
                name={returnNotesField(i.id)}
                maxLength={CUSTODY_TEXT_LIMITS.returnNotes}
                defaultValue={valueOf(state, returnNotesField(i.id), '')}
                placeholder="E.g. a cracked screen, the charger missing"
                className="input"
              />
            </div>
          </li>
        ))}
      </ul>
      <ul className="space-y-0.5 text-xs text-muted">
        {RETURN_CONDITIONS.map((c) => (
          <li key={c}>
            <span className="font-semibold">{RETURN_CONDITION_LABELS[c]}:</span> {RETURN_CONDITION_HINTS[c]}
          </li>
        ))}
      </ul>
      <SubmitButton pendingText="Receiving…">Receive back</SubmitButton>
    </form>
  );
}
