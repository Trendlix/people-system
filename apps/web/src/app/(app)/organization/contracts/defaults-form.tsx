'use client';

import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { ContractSettings, FormState } from '@/lib/types';

/**
 * What a new contract starts with (HR and Admin): the probation and the contract's length, in months. The basic share of
 * the gross and the basic wage social insurance Form 1 prints by default change the payroll sheet, so they are edited on
 * Payroll Setup (owner's request, 16 October 2026); the page shows them under this form.
 */
export function ContractDefaultsForm({
  action,
  settings,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  settings: ContractSettings;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} className="mt-4 space-y-5">
      <FormErrors errors={state.errors} />
      <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('probationMonths')} className="label">
            Probation (months)
          </label>
          <input
            id={fid('probationMonths')}
            name="probationMonths"
            type="number"
            required
            min={0}
            max={3}
            step={1}
            defaultValue={valueOf(state, 'probationMonths', String(settings.probationMonths))}
            aria-describedby={fid('probationMonths-hint')}
            className="input"
          />
          <p id={fid('probationMonths-hint')} className="hint">
            The law allows probation once per employer, up to 3 months (Labour Law Art. 90). 0 for none.
          </p>
        </div>
        <div>
          <label htmlFor={fid('durationMonths')} className="label">
            Contract length (months)
          </label>
          <input
            id={fid('durationMonths')}
            name="durationMonths"
            type="number"
            required
            min={1}
            step={1}
            defaultValue={valueOf(state, 'durationMonths', String(settings.durationMonths))}
            aria-describedby={fid('durationMonths-hint')}
            className="input"
          />
          <p id={fid('durationMonths-hint')} className="hint">
            Contracts are fixed-term: each runs this long, then is renewed or ends.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending}>Save</SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
