'use client';

import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// The small forms of Rooms, Kits and Settings (owner, 21 October 2026: "i want to add this module with a special
// permission to the system"): a name with notes (a new room or kit, or renaming one), archiving a room or bringing it
// back, and the capitalization threshold. The API checks who may and refuses a name already in use.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function Said({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p role="status" className="text-sm text-ok">
      {state.message}
    </p>
  );
}

/** A name and notes: adding a room or a kit (empty to start with), or changing one (`saved`). */
export function NameNotesForm({
  action,
  saved,
  nameLabel,
  nameHint,
  nameMax,
  notesMax,
  submit,
  compact = false,
}: {
  action: Action;
  saved?: { name: string; notes: string | null };
  nameLabel: string;
  nameHint?: string;
  nameMax: number;
  notesMax: number;
  submit: string;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  // a new one starts empty again once added (its form is reset by React after the action)
  return (
    <form action={formAction} className={compact ? 'space-y-3' : 'card space-y-4 p-5'}>
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('name')} className="label">
            {nameLabel}
          </label>
          <input
            id={fid('name')}
            name="name"
            required
            maxLength={nameMax}
            defaultValue={valueOf(state, 'name', saved?.name)}
            aria-describedby={nameHint ? fid('name-hint') : undefined}
            className="input"
          />
          {nameHint && (
            <p id={fid('name-hint')} className="hint">
              {nameHint}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={fid('notes')} className="label">
            Notes <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('notes')} name="notes" maxLength={notesMax} defaultValue={valueOf(state, 'notes', saved?.notes)} className="input" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{submit}</SubmitButton>
        <Said state={state} />
      </div>
    </form>
  );
}

/** Archive a room (it can't be chosen for an asset any more; the assets in it keep it) or bring it back. */
export function ArchiveButton({ action, archived, name }: { action: Action; archived: boolean; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <button type="submit" disabled={pending} className="inline-flex min-h-9 cursor-pointer items-center text-sm font-semibold text-accent hover:underline disabled:opacity-60">
        {pending ? 'Saving…' : archived ? 'Bring back' : 'Archive'}
        <span className="sr-only"> {name}</span>
      </button>
      <FormErrors errors={state.errors} />
    </form>
  );
}

/** The capitalization threshold, in EGP. */
export function ThresholdForm({ action, saved }: { action: Action; saved: string }) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="card max-w-xl space-y-4 p-5">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('threshold')} className="label">
          Capitalization threshold (EGP)
        </label>
        <input
          id={fid('threshold')}
          name="capitalizationThreshold"
          inputMode="decimal"
          autoComplete="off"
          required
          defaultValue={valueOf(state, 'capitalizationThreshold', saved)}
          aria-describedby={fid('threshold-hint')}
          className="input max-w-56 tabular-nums"
        />
        <p id={fid('threshold-hint')} className="hint">
          An asset bought for less than this is Expensed: its book value is 0 from the start. 0: none is.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save threshold</SubmitButton>
        <Said state={state} />
      </div>
    </form>
  );
}
