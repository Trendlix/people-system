'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BANKS, bankNamed } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { ListOrOther } from '@/components/list-or-other';
import type { EmployeeBank, FormState } from '@/lib/types';
import { accountCount, accountHint } from './bank-rules';

// Salaries are sent through EG-ACH, so the bank is chosen from the EG-ACH banks list (packages/shared banks.ts) and
// saved under the name the list gives it; Other keeps a bank not on the list as typed. A bank saved by its abbreviation
// (NBE) or in other capitals is recognised. For a bank on the list, the account number shows the length the bank uses
// and a count of the digits typed.
const BANK_LIST = {
  groups: [{ choices: [...BANKS].sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ value: b.name, label: `${b.name} (${b.short})` })) }],
  aliases: new Map(BANKS.flatMap((b) => [[b.short.toLowerCase(), b.name], [b.name.toLowerCase(), b.name]] as const)),
};

export function BankForm({
  action,
  employeeId,
  bank,
  profileName,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employeeId: string;
  bank: EmployeeBank;
  /** The profile's full name (English): the account holder until one is saved. */
  profileName: string;
}) {
  // Kept form: a refused save (e.g. an account number of the wrong length) leaves the bank as it was chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  const [bankName, setBankName] = useState(() => valueOf(state, 'bankName', bank.bankName));
  const [accountNo, setAccountNo] = useState(() => valueOf(state, 'accountNo', bank.accountNo));
  const [typing, setTyping] = useState(false);
  const listed = bankNamed(bankName);
  const accountRule = listed && accountHint(listed);
  const count = listed && accountCount(listed, accountNo);
  // The count warns once no more typing can make the number right, or when it is left at a length the bank doesn't use.
  // Only a warning: the API refuses the save anyway, with the bank's rule.
  const warn = Boolean(count && (count.over || (!count.fits && !typing)));
  const accountDescribedBy = [accountRule && fid('accountNo-hint'), count && fid('accountNo-count')].filter(Boolean).join(' ') || undefined;

  return (
    <form {...form} className="card max-w-2xl space-y-5 p-6">
      <FormErrors errors={state.errors} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('bankName')} className="label">
            Bank
          </label>
          <ListOrOther
            id={fid('bankName')}
            name="bankName"
            label="Bank"
            groups={BANK_LIST.groups}
            aliases={BANK_LIST.aliases}
            defaultValue={bankName}
            max={100}
            onValue={setBankName}
            otherPlaceholder="As written on the bank's letter"
            aria-describedby={fid('bankName-hint')}
          />
          <p id={fid('bankName-hint')} className="hint">
            As on the EG-ACH banks list. Not on it? Choose Other.
            {/* the SWIFT code (BIC) is the list's, so it is not typed or saved: it follows the bank */}
            {bankNamed(bankName)?.bic && (
              <>
                {' '}
                SWIFT/BIC: <span className="tabular-nums">{bankNamed(bankName)!.bic}</span>.
              </>
            )}
          </p>
        </div>
        <div>
          <label htmlFor={fid('accountNo')} className="label">
            Account number
          </label>
          <input
            id={fid('accountNo')}
            name="accountNo"
            autoComplete="off"
            inputMode={listed ? 'numeric' : undefined}
            maxLength={34}
            value={accountNo}
            onChange={(e) => setAccountNo(e.target.value)}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            aria-describedby={accountDescribedBy}
            aria-invalid={warn || undefined}
            className="input tabular-nums"
          />
          {accountRule && (
            <p id={fid('accountNo-hint')} className="hint">
              {accountRule} Spaces and dashes are fine.
            </p>
          )}
          {count && (
            <p id={fid('accountNo-count')} className={`hint tabular-nums ${warn ? 'text-warn' : ''}`}>
              {count.text}
            </p>
          )}
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
            defaultValue={valueOf(state, 'holderName', bank.holderName?.trim() || profileName)}
            className="input"
          />
          <p id={fid('holderName-hint')} className="hint">
            As registered at the bank.{!bank.holderName?.trim() && ' Filled in from the profile: change it if the bank has it otherwise.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>Save bank details</SubmitButton>
        <Link href={`/employees/${employeeId}`} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
