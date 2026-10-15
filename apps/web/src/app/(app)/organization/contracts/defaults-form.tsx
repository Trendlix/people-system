'use client';

import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { ContractSettings, FormState } from '@/lib/types';
import { plainAmount } from '../../employees/[id]/contracts/salary';

/**
 * What a new contract starts with (HR and Admin): the probation and the contract's length, in months; and the basic wage
 * social insurance Form 1 prints for an employee who has none of their own (owner, 16 October 2026).
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
        {settings.insuranceBasicDefault !== undefined && (
          <div className="sm:col-span-2 sm:max-w-sm">
            <label htmlFor={fid('insuranceBasicDefault')} className="label">
              Basic wage on social insurance forms (default)
            </label>
            <input
              id={fid('insuranceBasicDefault')}
              name="insuranceBasicDefault"
              required
              inputMode="decimal"
              autoComplete="off"
              defaultValue={valueOf(state, 'insuranceBasicDefault', plainAmount(settings.insuranceBasicDefault))}
              aria-describedby={fid('insuranceBasicDefault-hint')}
              className="input tabular-nums"
            />
            <p id={fid('insuranceBasicDefault-hint')} className="hint">
              In EGP. Printed in Form 1&apos;s <bdi lang="ar">أجر أساسي</bdi> boxes for an employee without a basic wage of their own on the
              Social Insurance tab. The contract&apos;s basic salary is not changed by it.
            </p>
          </div>
        )}
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
