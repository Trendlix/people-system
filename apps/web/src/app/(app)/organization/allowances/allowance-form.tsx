'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ALLOWANCE_BASIS_LABELS, ALLOWANCE_BASES } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { AllowanceType, FormState } from '@/lib/types';

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const choice =
  'flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

/**
 * A kind of allowance paid a month on top of the gross, e.g. Transport (owner's request, 15 October 2026): its names and
 * whether it is taxed and insured. A new one starts taxed and not insured, as a cash allowance is by law. How it is paid
 * (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal with it?"): a fixed amount a
 * month, or per client account assigned, chosen while no contract or offer has the kind (the API refuses otherwise).
 */
export function AllowanceTypeForm({ action, allowance }: { action: Action; allowance?: AllowanceType }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  // A checkbox is sent only when ticked: after a refused save, ticked if it was sent; otherwise as saved.
  const checked = (key: 'taxable' | 'insured', saved: boolean) => (state.values ? key in state.values : saved);

  return (
    <form {...form} className="card max-w-xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('nameEn')} className="label">
            Name (English)
          </label>
          <input
            id={fid('nameEn')}
            name="nameEn"
            required
            maxLength={100}
            placeholder="e.g. Transport"
            autoComplete="off"
            defaultValue={valueOf(state, 'nameEn', allowance?.nameEn)}
            aria-describedby={fid('name-hint')}
            className="input"
          />
        </div>
        <div>
          <label htmlFor={fid('nameAr')} className="label">
            Name (Arabic)
          </label>
          <input
            id={fid('nameAr')}
            name="nameAr"
            lang="ar"
            dir="rtl"
            required
            maxLength={100}
            autoComplete="off"
            defaultValue={valueOf(state, 'nameAr', allowance?.nameAr)}
            aria-describedby={fid('name-hint')}
            className="input"
          />
        </div>
      </div>
      <p id={fid('name-hint')} className="hint -mt-3">
        As it shows on contracts and job offers, and in their documents in each language. Each allowance has its own English
        name.
      </p>
      {allowance?.inUse ? (
        <div>
          <p className="label">How it is paid</p>
          <p>{ALLOWANCE_BASIS_LABELS[allowance.basis ?? 'fixed']}</p>
          <p className="hint">It is on contracts or job offers, so how it is paid stays. Add another allowance to pay it the other way.</p>
        </div>
      ) : (
        <fieldset className="space-y-2" aria-describedby={fid('basis-hint')}>
          <legend className="label">How it is paid</legend>
          {ALLOWANCE_BASES.map((b) => (
            <label key={b} className={choice}>
              <input
                type="radio"
                name="basis"
                value={b}
                defaultChecked={valueOf(state, 'basis', allowance?.basis ?? 'fixed') === b}
                className="size-4 accent-accent"
              />
              {ALLOWANCE_BASIS_LABELS[b]}
            </label>
          ))}
          <p id={fid('basis-hint')} className="hint">
            Per client account assigned: a contract or a job offer takes it with no amount, and payroll pays, each month, the
            amounts of the client accounts the person is assigned to under Clients → Client Accounts, by the days held.
          </p>
        </fieldset>
      )}
      <fieldset className="space-y-4">
        <legend className="label">Tax and insurance</legend>
        <div>
          <label className={choice}>
            <input
              type="checkbox"
              name="taxable"
              defaultChecked={checked('taxable', allowance?.taxable ?? true)}
              aria-describedby={fid('taxable-hint')}
              className="size-4 accent-accent"
            />
            Taxed
          </label>
          <p id={fid('taxable-hint')} className="hint">
            Taxed with the salary. By law an allowance paid in cash is taxed (Law 91/2005, Art. 9), a transport allowance
            too; only transport the company itself provides, such as its own buses, is exempt.
          </p>
        </div>
        <div>
          <label className={choice}>
            <input
              type="checkbox"
              name="insured"
              defaultChecked={checked('insured', allowance?.insured ?? false)}
              aria-describedby={fid('insured-hint')}
              className="size-4 accent-accent"
            />
            Insured
          </label>
          <p id={fid('insured-hint')} className="hint">
            Counted in the insured wage with the gross salary, within the year&apos;s maximum insurable wage.
          </p>
        </div>
      </fieldset>
      {allowance && <p className="hint">Contracts and job offers already drafted keep the names and treatment they were drafted with.</p>}
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>{allowance ? 'Save changes' : 'Create allowance'}</SubmitButton>
        <Link href="/organization/allowances" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** Makes the kind inactive, or active again (the action is bound to the new state); shows the API's reason if refused. */
export function AllowanceActiveForm({ action, active }: { action: Action; active: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Saving…' : active ? 'Make inactive' : 'Make active'}
      </button>
    </form>
  );
}
