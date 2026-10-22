'use client';

import { CUSTODY_TEXT_LIMITS, RETURN_CONDITION_HINTS, RETURN_CONDITION_LABELS, RETURN_CONDITIONS, type CustodyItemView } from '@trendlix/shared';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';
import { accessoryBackField, conditionField, returnNotesField } from '../custody';

// Receive back (Assets step 3; spec §6.4), for a custodian or a manager: each item still out with how it came back,
// good (available again), damaged (under repair, with an entry in its maintenance log: "Returned damaged on CUS-xxxx by
// {name}") or missing (lost), and notes; an item left as "Still out" stays with the person. Who received it and when are
// kept; the record is partly returned, or closed once everything is back. The API checks it again. Step 4 (owner, 22
// October 2026: accessories): the accessories that went out with each item, ticked again (or counted, for more than one).

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
            {i.accessoriesOut && i.accessoriesOut.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="label">Accessories back</legend>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {i.accessoriesOut.map((a, n) =>
                    a.quantity === 1 ? (
                      <li key={n}>
                        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3">
                          <input type="checkbox" name={accessoryBackField(i.id, n)} value="1" defaultChecked={valueOf(state, accessoryBackField(i.id, n), '1') === '1'} />
                          {a.name}
                          {a.serial && <span className="font-mono text-xs text-muted">{a.serial}</span>}
                        </label>
                      </li>
                    ) : (
                      <li key={n} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3">
                        <label htmlFor={fid(accessoryBackField(i.id, n))}>{a.name}</label>
                        <input
                          id={fid(accessoryBackField(i.id, n))}
                          name={accessoryBackField(i.id, n)}
                          inputMode="numeric"
                          autoComplete="off"
                          defaultValue={valueOf(state, accessoryBackField(i.id, n), String(a.quantity))}
                          className="input w-16 tabular-nums"
                        />
                        <span className="text-muted">of {a.quantity}</span>
                      </li>
                    ),
                  )}
                </ul>
                <p className="hint">Untick, or lower the number of, what didn&apos;t come back: it stays on the person&apos;s record. An item missing has its accessories missing too.</p>
              </fieldset>
            )}
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
