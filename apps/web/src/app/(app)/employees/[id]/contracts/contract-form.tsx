'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CONTRACT_FORM_LABELS, CONTRACT_FORMS, type ContractForm as Form } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate, parseDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { contractEnd, probationEnd } from './dates';
import { formatAmount, formatEgp, insuredFor, parseAmount, splitSalary } from './salary';

// The form of the New contract, Renew and Edit draft pages. While HR types, it shows when the contract ends, when
// probation ends, the basic and variable parts of the gross and, for a full-time contract, the insured salary on the
// social insurance copy. The API works these out again when it saves.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** What the form starts with: the draft being changed, or the settings and defaults. Dates are YYYY-MM-DD. */
export type ContractDefaults = {
  form: Form;
  startDate: string;
  durationMonths: number;
  probationMonths: number;
  grossSalary: number | null;
  basicPercent: number;
  netSalary: number | null;
  note: string;
};

const amountText = (n: number | null) => (n === null ? '' : String(n));
const optional = <span className="font-normal text-muted">(optional)</span>;

export function ContractForm({
  action,
  defaults,
  renewal,
  probationHint,
  fullTime,
  today,
  cancelHref,
  submitLabel,
}: {
  action: Action;
  defaults: ContractDefaults;
  /** A renewal starts the day after the version before it ends (`startDate`, null when unknown), without probation. */
  renewal: { startDate: string | null; after: string } | null;
  /** Why the probation starts as it does, e.g. someone who already had probation with the company. */
  probationHint?: string;
  /** Full-time contracts have a social insurance copy, whose salary is the insured salary. */
  fullTime: boolean;
  /** YYYY-MM-DD, for the insured salary's year while there is no start date. */
  today: string;
  cancelHref: string;
  submitLabel: string;
}) {
  // Kept form: a refused save leaves everything as typed and chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  // What is typed, for the previews (the fields themselves stay uncontrolled).
  const [typed, setTyped] = useState<Record<string, string>>(() => ({
    form: valueOf(state, 'form', defaults.form),
    startDate: valueOf(state, 'startDate', formatDate(defaults.startDate)),
    durationMonths: valueOf(state, 'durationMonths', String(defaults.durationMonths)),
    probationMonths: valueOf(state, 'probationMonths', String(defaults.probationMonths)),
    grossSalary: valueOf(state, 'grossSalary', amountText(defaults.grossSalary)),
    basicPercent: valueOf(state, 'basicPercent', String(defaults.basicPercent)),
  }));
  function track(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target;
    if ((t instanceof HTMLInputElement || t instanceof HTMLSelectElement) && t.name) setTyped((v) => ({ ...v, [t.name]: t.value }));
  }

  const fixed = typed.form === 'fixed';
  const start = renewal ? renewal.startDate : parseDate(typed.startDate) || null;
  const months = Number(typed.durationMonths);
  const end = fixed && start && Number.isInteger(months) && months >= 1 ? contractEnd(start, months) : null;
  const probation = renewal ? 0 : Number(typed.probationMonths);
  const probationEnds = start && Number.isInteger(probation) && probation > 0 && probation <= 3 ? probationEnd(start, probation) : null;
  const gross = parseAmount(typed.grossSalary);
  const grossOk = gross !== null && !Number.isNaN(gross) && gross > 0;
  const basicPercent = Number(typed.basicPercent);
  const split = grossOk && Number.isInteger(basicPercent) && basicPercent >= 1 && basicPercent <= 100 ? splitSalary(gross, basicPercent) : null;
  const insured = grossOk ? insuredFor(gross, Number((start ?? today).slice(0, 4))) : null;

  return (
    <form {...form} onChange={track} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />

      <fieldset aria-describedby={fid('form-hint')}>
        <legend className="label">Term</legend>
        <div className="flex flex-wrap gap-2">
          {CONTRACT_FORMS.map((f) => (
            <label
              key={f}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft"
            >
              <input type="radio" name="form" value={f} defaultChecked={typed.form === f} className="size-4 accent-accent" />
              {CONTRACT_FORM_LABELS[f]}
            </label>
          ))}
        </div>
        <p id={fid('form-hint')} className="hint">
          Contracts are fixed-term, renewed in writing before they end. If work continues without a written renewal, the contract becomes open-ended (Labour Law
          Art. 88).
        </p>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('startDate')} className="label">
            Start date
          </label>
          {renewal ? (
            // not sent: a renewal starts the day after the version before it ends
            <input
              id={fid('startDate')}
              value={renewal.startDate ? formatDate(renewal.startDate) : 'The day after the current version ends'}
              readOnly
              aria-describedby={fid('startDate-hint')}
              className="input bg-canvas text-muted"
            />
          ) : (
            <DateInput
              id={fid('startDate')}
              name="startDate"
              aria-describedby={fid('startDate-hint')}
              defaultValue={valueOf(state, 'startDate', formatDate(defaults.startDate))}
            />
          )}
          <p id={fid('startDate-hint')} className="hint">
            {renewal
              ? `A renewal starts the day after ${renewal.after} ends.`
              : 'The join date, unless the contract starts later. Leave empty for the join date.'}
          </p>
        </div>

        {fixed ? (
          <div>
            <label htmlFor={fid('durationMonths')} className="label">
              Length in months
            </label>
            <input
              id={fid('durationMonths')}
              name="durationMonths"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              step={1}
              required
              aria-describedby={fid('durationMonths-hint')}
              defaultValue={typed.durationMonths}
              className="input tabular-nums"
            />
            <p id={fid('durationMonths-hint')} className="hint">
              {end ? `Ends on ${formatDate(end)}.` : start ? 'Enter the length to see when it ends.' : 'Enter the start date to see when it ends.'}
            </p>
          </div>
        ) : (
          <div>
            <p className="label">Length</p>
            <p className="flex min-h-11 items-center text-sm text-muted">No end date{start && `: from ${formatDate(start)}`}</p>
          </div>
        )}

        <div>
          <label htmlFor={fid('probationMonths')} className="label">
            Probation in months
          </label>
          {renewal ? (
            // not sent: no probation on a renewal
            <input id={fid('probationMonths')} value="0" readOnly aria-describedby={fid('probationMonths-hint')} className="input bg-canvas text-muted" />
          ) : (
            <input
              id={fid('probationMonths')}
              name="probationMonths"
              type="number"
              inputMode="numeric"
              min={0}
              max={3}
              step={1}
              aria-describedby={fid('probationMonths-hint')}
              defaultValue={valueOf(state, 'probationMonths', String(defaults.probationMonths))}
              className="input tabular-nums"
            />
          )}
          <p id={fid('probationMonths-hint')} className="hint">
            {renewal
              ? 'No probation on a renewal: probation comes once with an employer (Labour Law Art. 90).'
              : `${probationHint ?? 'At most 3 months, and only once with the company (Labour Law Art. 90). 0 for none.'}${probationEnds ? ` Probation ends on ${formatDate(probationEnds)}.` : ''}`}
          </p>
        </div>
      </div>

      <div className="grid gap-5 border-t border-line pt-6 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('grossSalary')} className="label">
            Gross salary (EGP)
          </label>
          <input
            id={fid('grossSalary')}
            name="grossSalary"
            inputMode="decimal"
            autoComplete="off"
            required
            aria-describedby={fid('grossSalary-hint')}
            defaultValue={valueOf(state, 'grossSalary', amountText(defaults.grossSalary))}
            className="input tabular-nums"
          />
          <p id={fid('grossSalary-hint')} className="hint">
            {fullTime && insured
              ? `Insured salary on the social insurance copy: ${formatAmount(insured.amount)}, ${insured.why}.`
              : fullTime
                ? 'The actual monthly gross. The social insurance copy shows it capped at the maximum insurable wage.'
                : 'The actual monthly gross.'}
          </p>
        </div>
        <div>
          <label htmlFor={fid('basicPercent')} className="label">
            Basic part (%)
          </label>
          <input
            id={fid('basicPercent')}
            name="basicPercent"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            step={1}
            aria-describedby={fid('basicPercent-hint')}
            defaultValue={valueOf(state, 'basicPercent', String(defaults.basicPercent))}
            className="input tabular-nums"
          />
          <p id={fid('basicPercent-hint')} className="hint">
            {split
              ? `Basic ${formatEgp(split.basic)} · variable ${formatEgp(split.variable)}, which follows the monthly performance reports.`
              : 'The rest of the gross is variable, following the monthly performance reports.'}
          </p>
        </div>
        <div>
          <label htmlFor={fid('netSalary')} className="label">
            Approximate net salary (EGP) {optional}
          </label>
          <input
            id={fid('netSalary')}
            name="netSalary"
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={fid('netSalary-hint')}
            defaultValue={valueOf(state, 'netSalary', amountText(defaults.netSalary))}
            className="input tabular-nums"
          />
          <p id={fid('netSalary-hint')} className="hint">
            As agreed with the employee, for the official copy.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor={fid('note')} className="label">
          Note {optional}
        </label>
        <textarea
          id={fid('note')}
          name="note"
          rows={3}
          maxLength={500}
          aria-describedby={fid('note-hint')}
          defaultValue={valueOf(state, 'note', defaults.note)}
          className="input"
        />
        <p id={fid('note-hint')} className="hint">
          E.g. what was agreed beyond the contract. Up to 500 characters.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
