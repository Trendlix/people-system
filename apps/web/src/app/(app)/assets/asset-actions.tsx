'use client';

import { MAINTENANCE_TEXT_LIMITS, type AssetAction } from '@trendlix/shared';
import { useActionState, useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// An asset's page actions besides editing it and handing it over (Assets step 3, the brief: "send to repair / back from
// repair (a maintenance entry), mark lost / found"), for a custodian or a manager, each only while its status allows it
// (packages/shared assetActionProblem): Send to repair (an available asset: the date, the vendor, notes), Back from repair
// (the same, and its cost for the CEO, Finance and a Super Admin, a value), Mark lost (an available asset or one under
// repair; one in custody is lost by receiving it back missing), Mark found (a lost one). Each opens its small form in
// place; the API checks it again and keeps a maintenance entry for a repair.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type Shown = Exclude<AssetAction, 'hand_over'>;

const LABELS: Record<Shown, { open: string; save: string; repair: boolean }> = {
  send_to_repair: { open: 'Send to repair', save: 'Send to repair', repair: true },
  back_from_repair: { open: 'Back from repair', save: 'Back from repair', repair: true },
  mark_lost: { open: 'Mark lost', save: 'Mark lost', repair: false },
  mark_found: { open: 'Mark found', save: 'Mark found', repair: false },
};

function ActionForm({ kind, action, values, onClose }: { kind: Shown; action: Action; values: boolean; onClose: () => void }) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  const l = LABELS[kind];
  if (state.message) {
    return (
      <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
        {state.message}
      </p>
    );
  }
  return (
    <form action={formAction} aria-label={l.open} className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      {l.repair && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('on')} className="label">
              Date <span className="font-normal text-muted">(today unless set)</span>
            </label>
            <DateInput id={fid('on')} name="on" defaultValue={String(valueOf(state, 'on', ''))} />
          </div>
          <div>
            <label htmlFor={fid('vendor')} className="label">
              Vendor <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id={fid('vendor')} name="vendor" maxLength={MAINTENANCE_TEXT_LIMITS.vendor} defaultValue={valueOf(state, 'vendor', '')} className="input" />
          </div>
          {kind === 'back_from_repair' && values && (
            <div>
              <label htmlFor={fid('cost')} className="label">
                Cost (EGP) <span className="font-normal text-muted">(optional)</span>
              </label>
              <input id={fid('cost')} name="cost" inputMode="decimal" autoComplete="off" defaultValue={valueOf(state, 'cost', '')} className="input tabular-nums" />
            </div>
          )}
        </div>
      )}
      <div>
        <label htmlFor={fid('notes')} className="label">
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={fid('notes')} name="notes" rows={2} maxLength={MAINTENANCE_TEXT_LIMITS.notes} defaultValue={valueOf(state, 'notes', '')} className="input" />
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{l.save}</SubmitButton>
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Close
        </button>
      </div>
    </form>
  );
}

/** The actions the asset's status allows now, each with its form; `actions`: the server actions, by kind. */
export function AssetActions({ can, actions, values }: { can: Record<AssetAction, boolean>; actions: Partial<Record<Shown, Action>>; values: boolean }) {
  const [open, setOpen] = useState<Shown | null>(null);
  const shown = (Object.keys(LABELS) as Shown[]).filter((k) => can[k] && actions[k]);
  if (!shown.length) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {shown.map((k) => (
          <button key={k} type="button" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} className={`btn ${open === k ? 'btn-primary' : 'btn-secondary'}`}>
            {LABELS[k].open}
          </button>
        ))}
      </div>
      {open && <ActionForm key={open} kind={open} action={actions[open]!} values={values} onClose={() => setOpen(null)} />}
    </div>
  );
}
