'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { EmployeeBank, FormState } from '@/lib/types';

export function BankForm({
  action,
  employeeId,
  bank,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employeeId: string;
  bank: EmployeeBank;
}) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();

  return (
    <form action={formAction} className="card max-w-2xl space-y-5 p-6">
      <FormErrors errors={state.errors} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('bankName')} className="label">
            Bank
          </label>
          <input id={fid('bankName')} name="bankName" maxLength={100} defaultValue={valueOf(state, 'bankName', bank.bankName)} className="input" />
        </div>
        <div>
          <label htmlFor={fid('branch')} className="label">
            Branch
          </label>
          <input id={fid('branch')} name="branch" maxLength={100} defaultValue={valueOf(state, 'branch', bank.branch)} className="input" />
        </div>
        <div>
          <label htmlFor={fid('accountNo')} className="label">
            Account number
          </label>
          <input
            id={fid('accountNo')}
            name="accountNo"
            autoComplete="off"
            maxLength={34}
            defaultValue={valueOf(state, 'accountNo', bank.accountNo)}
            className="input tabular-nums"
          />
        </div>
        <div>
          <label htmlFor={fid('iban')} className="label">
            IBAN
          </label>
          <input
            id={fid('iban')}
            name="iban"
            autoComplete="off"
            maxLength={40}
            placeholder="EG00 0000 0000 0000 0000 0000 0000 0"
            aria-describedby={fid('iban-hint')}
            defaultValue={valueOf(state, 'iban', bank.iban)}
            className="input uppercase tabular-nums"
          />
          <p id={fid('iban-hint')} className="hint">
            EG followed by 27 digits. Spaces are fine.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('holderName')} className="label">
            Account holder
          </label>
          <input
            id={fid('holderName')}
            name="holderName"
            maxLength={150}
            aria-describedby={fid('holderName-hint')}
            defaultValue={valueOf(state, 'holderName', bank.holderName)}
            className="input"
          />
          <p id={fid('holderName-hint')} className="hint">
            As registered at the bank.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton>Save bank details</SubmitButton>
        <Link href={`/employees/${employeeId}`} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
