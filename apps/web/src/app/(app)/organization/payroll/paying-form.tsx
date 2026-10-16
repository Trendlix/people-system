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
            aria-describedby={fid('cibDebitAccount-hint')}
            className="input tabular-nums"
          />
          <p id={fid('cibDebitAccount-hint')} className="hint">
            The company&apos;s 12-digit CIB account, the debit line at the top of the CIB file.
          </p>
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
            aria-describedby={fid('cibDebitAccountName-hint')}
            className="input"
          />
          <p id={fid('cibDebitAccountName-hint')} className="hint">
            As CIB has it.
          </p>
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
            aria-describedby={fid('achPurpose-hint')}
            className="input"
          />
          <p id={fid('achPurpose-hint')} className="hint">
            The transaction purpose on every line of the ACH file, e.g. CASH.
          </p>
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
              aria-describedby={fid('payday-hint')}
              className="input w-24 tabular-nums"
            />
            <p id={fid('payday-hint')} className="hint">
              The day of the month the salaries are paid, 1 to 31, in the month after the one they are for: with 5, the September salaries on 5
              October. A day past a month&apos;s end is its last day. Mark as paid starts from this date; empty, from today.
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
