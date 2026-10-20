'use client';

import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// Attendance → Check-in Setup → Zoho People's Check-in Addresses (owner, 19 October 2026: "13 and 17 al mahrouki is also
// in office"; moved here from Payroll Setup → Your Rules on 20 October 2026, "Own page, several locations"): the office's
// addresses as Zoho People writes a check-in's location, one a line. An imported check-in at one of them is a day at the
// office, anywhere else remote; only that is kept, never the address.

export function ZohoAddressesForm({ action, addresses }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; addresses: readonly string[] }) {
  const fid = useFieldIds();
  const { state, pending, form } = useKeptForm(action);
  return (
    <form {...form} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('officeAddresses')} className="label">
          The office&apos;s addresses as Zoho People writes them, one a line
        </label>
        <textarea
          id={fid('officeAddresses')}
          name="officeAddresses"
          rows={Math.max(4, addresses.length + 1)}
          defaultValue={valueOf(state, 'officeAddresses', addresses.join('\n'))}
          aria-describedby={fid('officeAddresses-hint')}
          className="input max-w-xl"
        />
        <p id={fid('officeAddresses-hint')} className="hint">
          For attendance from Zoho People: a check-in at one of these is a day at the office, anywhere else remote, and only that is kept, never the
          address. Part of the address as Zoho People writes it, e.g. 15, Al Doctor Al Mahrouqi Street, or the company&apos;s name. At most 20.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending}>Save addresses</SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
