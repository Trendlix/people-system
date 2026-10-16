'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// The Social Insurance tab's items HR changes in place (owner, 16 October 2026): the occupation, the subscription start
// and the basic and comprehensive wages Form 1 prints (its insured wage is worked out from the comprehensive wage, not
// edited: owner's decision, 16 October 2026). Each shows how it reads now, with Edit for those who may change it, which opens a
// small form in its place; saving shows the saved value and closes it, a refused save keeps it open with the reason.

// The occupation picker brings the social insurance occupation table (3,052 rows) with it: loaded only once the form is
// opened, so the table ships only when someone changes an occupation.
const OccupationPicker = dynamic(() => import('./occupation-picker').then((m) => m.OccupationPicker), {
  loading: () => <p className="input flex max-w-lg items-center text-muted">Loading the occupations…</p>,
});

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const textButton = 'inline-flex min-h-9 items-center text-sm font-semibold text-accent hover:underline';

/** Moves focus into the field when the form opens (a stable function, so a later render doesn't move it again). */
const focusOnOpen = (el: HTMLElement | null) => (el instanceof HTMLInputElement ? el : el?.querySelector('input'))?.focus();

/**
 * An item as it reads now (`children`) and its Edit button; `form` draws the open form, given how to close it. Without
 * an action (not HR, or salary data the caller may not change), only how it reads.
 */
function Editable({
  action,
  name,
  editText = 'Edit',
  children,
  form,
}: {
  action: Action | null;
  /** What is edited, for screen readers: "occupation". */
  name: string;
  editText?: string;
  children: React.ReactNode;
  form: (action: Action, close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!action) return <>{children}</>;
  if (open) return <>{form(action, () => setOpen(false))}</>;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      {children}
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={textButton}>
        {editText}
        {editText === 'Edit' && <span className="sr-only"> {name}</span>}
      </button>
    </div>
  );
}

/**
 * The small form in an item's place, spanning the tab's details grid while open (`data-editing`, see FieldGrid). Its
 * field comes from `children`, given the form's state (to refill what was typed after a refusal) and its ids.
 */
function DetailForm({
  action,
  name,
  close,
  children,
}: {
  action: Action;
  name: string;
  close: () => void;
  children: (state: FormState, fid: (key: string) => string) => React.ReactNode;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  // a save that went through closes the form (the page then shows the saved value)
  useEffect(() => {
    if (state.message) close();
  }, [state, close]);

  return (
    <form {...form} data-editing="" aria-label={`Change the ${name}`} className="mt-1 max-w-xl space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      {children(state, fid)}
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>Save</SubmitButton>
        <button type="button" onClick={close} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The occupation in the social insurance table, picked by part of its Arabic name or its code; none clears it. */
export function OccupationDetail({ action, code, children }: { action: Action | null; code: string | null; children: React.ReactNode }) {
  return (
    <Editable
      action={action}
      name="occupation"
      editText={code ? 'Edit' : 'Set occupation'}
      form={(act, close) => (
        <DetailForm action={act} name="occupation" close={close}>
          {(state, fid) => (
            <div>
              <label htmlFor={fid('occupationCode')} className="label">
                Occupation
              </label>
              <OccupationPicker
                id={fid('occupationCode')}
                name="occupationCode"
                defaultValue={valueOf(state, 'occupationCode', code)}
                describedBy={fid('occupationCode-hint')}
                autoFocus
              />
              <p id={fid('occupationCode-hint')} className="hint">
                Printed on social insurance Form 1 (<bdi lang="ar">كود المهنة</bdi> and <bdi lang="ar">المسمى</bdi>). Type part of the
                Arabic name, or the code.
              </p>
            </div>
          )}
        </DetailForm>
      )}
    >
      {children}
    </Editable>
  );
}

/** The subscription start, typed as DD/MM/YYYY; empty: the join date is printed. */
export function StartDateDetail({ action, value, children }: { action: Action | null; value: string; children: React.ReactNode }) {
  return (
    <Editable
      action={action}
      name="subscription start"
      form={(act, close) => (
        <DetailForm action={act} name="subscription start" close={close}>
          {(state, fid) => (
            <div>
              <label htmlFor={fid('insuranceStartDate')} className="label">
                Subscription start
              </label>
              <div ref={focusOnOpen} className="max-w-48">
                <DateInput
                  id={fid('insuranceStartDate')}
                  name="insuranceStartDate"
                  aria-describedby={fid('insuranceStartDate-hint')}
                  defaultValue={valueOf(state, 'insuranceStartDate', value)}
                />
              </div>
              <p id={fid('insuranceStartDate-hint')} className="hint">
                Printed in Form 1&apos;s <bdi lang="ar">تاريخ بدء الاشتراك</bdi> boxes. Leave empty to use the join date.
              </p>
            </div>
          )}
        </DetailForm>
      )}
    >
      {children}
    </Editable>
  );
}

/** One of the wages, in EGP to the piastre; empty: what stands in for it is printed (`hint` says what). */
export function WageDetail({
  action,
  field,
  name,
  label,
  value,
  hint,
  children,
}: {
  action: Action | null;
  field: 'insuranceBasicWage' | 'insuranceComprehensiveWage';
  /** "basic wage", for the form's name. */
  name: string;
  /** The field's label: "Basic wage (EGP)". */
  label: string;
  /** The employee's own, with two decimals ("2500.50"), or "". */
  value: string;
  hint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Editable
      action={action}
      name={name}
      form={(act, close) => (
        <DetailForm action={act} name={name} close={close}>
          {(state, fid) => (
            <div>
              <label htmlFor={fid(field)} className="label">
                {label}
              </label>
              <input
                ref={focusOnOpen}
                id={fid(field)}
                name={field}
                inputMode="decimal"
                autoComplete="off"
                aria-describedby={fid(`${field}-hint`)}
                defaultValue={valueOf(state, field, value)}
                className="input max-w-48 tabular-nums"
              />
              <p id={fid(`${field}-hint`)} className="hint">
                {hint}
              </p>
            </div>
          )}
        </DetailForm>
      )}
    >
      {children}
    </Editable>
  );
}
