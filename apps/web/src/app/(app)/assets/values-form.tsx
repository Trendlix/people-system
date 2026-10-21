'use client';

import { ASSET_TEXT_LIMITS } from '@trendlix/shared';
import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// An asset's values alone (owner, 21 October 2026: "CEO and Finance"): what the CEO, Finance and a Super Admin set,
// whatever their Assets access ("Edit values" on the asset's page, and each asset on Needs Values): the purchase cost,
// the supplier and invoice number, and the market value (low, mid, high) with how it was reached. All in EGP. The book
// value is worked out from them; the API checks them again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

export function ValuesForm({ action, saved, cancelHref }: { action: Action; saved: Record<string, string>; cancelHref: string }) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  const money = (name: string, label: string, hint?: string) => (
    <div>
      <label htmlFor={fid(name)} className="label">
        {label} {optional}
      </label>
      <input
        id={fid(name)}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        defaultValue={valueOf(state, name, saved[name])}
        aria-describedby={hint ? fid(`${name}-hint`) : undefined}
        className="input tabular-nums"
      />
      {hint && (
        <p id={fid(`${name}-hint`)} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
  return (
    <form action={formAction} className="card space-y-5 p-5">
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2">
        {money('purchasePrice', 'Purchase cost (EGP)', 'From the invoice, e.g. 45000 or 45000.50.')}
        <div>
          <label htmlFor={fid('supplier')} className="label">
            Supplier {optional}
          </label>
          <input id={fid('supplier')} name="supplier" maxLength={ASSET_TEXT_LIMITS.supplier} defaultValue={valueOf(state, 'supplier', saved.supplier)} className="input" />
        </div>
        <div>
          <label htmlFor={fid('invoiceNo')} className="label">
            Invoice number {optional}
          </label>
          <input id={fid('invoiceNo')} name="invoiceNo" maxLength={ASSET_TEXT_LIMITS.invoiceNo} defaultValue={valueOf(state, 'invoiceNo', saved.invoiceNo)} className="input" />
        </div>
        {money('marketValue', 'Market value (EGP)', 'What it would fetch now in Egypt, in its condition.')}
        {money('priceLow', 'Market value, low (EGP)')}
        {money('priceHigh', 'Market value, high (EGP)')}
        <div className="sm:col-span-2">
          <label htmlFor={fid('priceNote')} className="label">
            How the market value was reached {optional}
          </label>
          <textarea
            id={fid('priceNote')}
            name="priceNote"
            rows={2}
            maxLength={ASSET_TEXT_LIMITS.priceNote}
            defaultValue={valueOf(state, 'priceNote', saved.priceNote)}
            aria-describedby={fid('priceNote-hint')}
            className="input"
          />
          <p id={fid('priceNote-hint')} className="hint">
            One or two sentences, e.g. three listings for the same model in good condition.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton>Save values</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
