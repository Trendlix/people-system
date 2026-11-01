'use client';

import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState, PayrollSettingsView } from '@/lib/types';

// Payroll Setup → Paying Salaries (HR and Admin; owner's request, 16 October 2026): what the bank files need (the
// company's CIB account the salaries are paid from, its name as CIB has it, the ACH file's purpose) and the payday, the
// day of the month the salaries are paid, which Mark as paid starts from.

export function PayingSalariesForm({ action, settings }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; settings: PayrollSettingsView }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} className="space-y-6">
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('cibDebitAccount')} className="label">
            CIB account the salaries are paid from
          </label>
          <input
            id={fid('cibDebitAccount')}
            name="cibDebitAccount"
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            defaultValue={valueOf(state, 'cibDebitAccount', settings.cibDebitAccount)}
            placeholder="12 digits"
            className="input tabular-nums"
          />
        </div>
        <div>
          <label htmlFor={fid('cibDebitAccountName')} className="label">
            Account name
          </label>
          <input
            id={fid('cibDebitAccountName')}
            name="cibDebitAccountName"
            autoComplete="off"
            maxLength={100}
            defaultValue={valueOf(state, 'cibDebitAccountName', settings.cibDebitAccountName)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor={fid('achPurpose')} className="label">
            ACH purpose
          </label>
          <input
            id={fid('achPurpose')}
            name="achPurpose"
            required
            autoComplete="off"
            maxLength={20}
            defaultValue={valueOf(state, 'achPurpose', settings.achPurpose)}
            placeholder="e.g. CASH"
            className="input"
          />
        </div>
        {settings.payday !== undefined && (
          <div>
            <label htmlFor={fid('payday')} className="label">
              Payday <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={fid('payday')}
              name="payday"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              defaultValue={valueOf(state, 'payday', settings.payday === null ? '' : String(settings.payday))}
              placeholder="1–31"
              className="input w-24 tabular-nums"
            />
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
