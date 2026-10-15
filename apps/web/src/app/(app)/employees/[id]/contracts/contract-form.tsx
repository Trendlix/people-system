'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CONTRACT_FORM_LABELS, CONTRACT_FORMS, type ContractForm as Form } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate, parseDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { contractEnd, probationEnd } from './dates';
import {
  basisFrom,
  breakdownRows,
  formatAmount,
  formatEgp,
  insuredFor,
  plainAmount,
  SALARY_BASES,
  SALARY_BASIS_LABELS,
  salaryFor,
  savedNetChange,
  splitSalary,
  switchBasis,
  workedOutGross,
} from './salary';
import { SalaryBreakdownList } from './salary-breakdown';

// The form of the New contract, Renew and Edit draft pages. While HR types, it shows when the contract ends, when
// probation ends, the basic and variable parts of the gross, for a full-time contract the insured salary on the social
// insurance copy, and the salary's breakdown down to the net. The API works the dates and parts out again when it saves.
//
// The salary (owner, 15 October 2026: "add the calculation method to calculate the net and gross salary"): HR starts
// from the gross, and the net is worked out, or from the net wanted, and the gross is worked out in whole pounds, as the
// Ministry of Finance's salary tax system does for the contract's start year. The form sends both as grossSalary and
// netSalary, so the contract's {{net_salary}} is the calculated net; the typed net (wantedNet) and the switch
// (salaryBasis) go along only to be kept if the save is refused.

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
const NET_INVALID = 'Enter the net salary as an amount in EGP, e.g. 13,000.';

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
  /** YYYY-MM-DD, for the salary's year (its insurable wage limits) while there is no start date. */
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
    salaryBasis: valueOf(state, 'salaryBasis', 'gross'),
    grossSalary: valueOf(state, 'grossSalary', amountText(defaults.grossSalary)),
    wantedNet: valueOf(state, 'wantedNet', ''),
    basicPercent: valueOf(state, 'basicPercent', String(defaults.basicPercent)),
  }));

  const fixed = typed.form === 'fixed';
  const start = renewal ? renewal.startDate : parseDate(typed.startDate) || null;
  const months = Number(typed.durationMonths);
  const end = fixed && start && Number.isInteger(months) && months >= 1 ? contractEnd(start, months) : null;
  const probation = renewal ? 0 : Number(typed.probationMonths);
  const probationEnds = start && Number.isInteger(probation) && probation > 0 && probation <= 3 ? probationEnd(start, probation) : null;
  // the salary, with the insurable wage limits of the year the contract starts (this year while there is no start date)
  const year = Number((start ?? today).slice(0, 4));
  const basis = basisFrom(typed.salaryBasis);
  const salary = salaryFor(basis, basis === 'net' ? typed.wantedNet : typed.grossSalary, year);
  const calc = salary.kind === 'ok' ? salary.breakdown : null;
  const gross = calc?.gross ?? null;
  const basicPercent = Number(typed.basicPercent);
  const split = gross !== null && Number.isInteger(basicPercent) && basicPercent >= 1 && basicPercent <= 100 ? splitSalary(gross, basicPercent) : null;
  const insured = gross !== null ? insuredFor(gross, year) : null;
  const insuredText = fullTime && insured ? `Insured salary on the social insurance copy: ${formatAmount(insured.amount)}, ${insured.why}.` : null;
  const savedNet = savedNetChange({ gross: defaults.grossSalary, net: defaults.netSalary }, calc);

  function track(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target;
    if (!((t instanceof HTMLInputElement || t instanceof HTMLSelectElement) && t.name)) return;
    const { name, value } = t;
    if (name === 'salaryBasis') {
      // the other field starts with what this one gives, so the salary stays the same
      setTyped((v) => {
        const s = switchBasis(basisFrom(value), { gross: v.grossSalary, net: v.wantedNet }, year);
        return { ...v, salaryBasis: value, grossSalary: s.gross, wantedNet: s.net };
      });
      return;
    }
    setTyped((v) => ({ ...v, [name]: value }));
  }

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

      <div className="space-y-5 border-t border-line pt-6">
        <fieldset aria-describedby={fid('salaryBasis-hint')}>
          <legend className="label">Start from</legend>
          <div className="flex flex-wrap gap-2">
            {SALARY_BASES.map((b) => (
              <label
                key={b}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft"
              >
                <input type="radio" name="salaryBasis" value={b} defaultChecked={basis === b} className="size-4 accent-accent" />
                {SALARY_BASIS_LABELS[b]}
              </label>
            ))}
          </div>
          <p id={fid('salaryBasis-hint')} className="hint">
            {basis === 'net' ? 'Type the net wanted: the gross is worked out, in whole pounds.' : 'Type the gross: the net is worked out.'}
          </p>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          {basis === 'gross' ? (
            <div key="gross">
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
                defaultValue={typed.grossSalary}
                className="input tabular-nums"
              />
              <p id={fid('grossSalary-hint')} className="hint">
                {insuredText ??
                  (fullTime
                    ? 'The actual monthly gross. The social insurance copy shows it capped at the maximum insurable wage.'
                    : 'The actual monthly gross.')}
              </p>
            </div>
          ) : (
            <div key="net">
              <label htmlFor={fid('wantedNet')} className="label">
                Net salary wanted (EGP)
              </label>
              <input
                id={fid('wantedNet')}
                name="wantedNet"
                inputMode="decimal"
                autoComplete="off"
                required
                aria-describedby={fid('wantedNet-hint')}
                defaultValue={typed.wantedNet}
                // only the gross worked out from it is saved, so a mistake is caught here rather than as a missing gross
                ref={(el) => el?.setCustomValidity(salary.kind === 'invalid' ? NET_INVALID : '')}
                className="input tabular-nums"
              />
              <p id={fid('wantedNet-hint')} className="hint">
                {salary.kind === 'ok' ? `${workedOutGross(salary.typed, salary.breakdown)}${insuredText ? ` ${insuredText}` : ''}` : 'The monthly net to pay.'}
              </p>
              {/* what is saved: the gross worked out */}
              <input type="hidden" name="grossSalary" value={calc ? plainAmount(calc.gross) : ''} />
            </div>
          )}
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
        </div>

        <div>
          <p id={fid('breakdown')} className="label">
            Monthly breakdown
          </p>
          {calc ? (
            <SalaryBreakdownList rows={breakdownRows(calc)} labelledBy={fid('breakdown')} />
          ) : (
            <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
              {salary.kind === 'invalid'
                ? `Enter the ${basis === 'net' ? 'net' : 'gross'} salary as an amount in EGP to see the breakdown, e.g. 15,000.`
                : `Enter the ${basis === 'net' ? 'net' : 'gross'} salary to see the breakdown.`}
            </p>
          )}
          {/* what is saved, and goes into the contract as {{net_salary}}: the net worked out */}
          <input type="hidden" name="netSalary" value={calc ? plainAmount(calc.net) : ''} />
          {savedNet && (
            <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              The net saved before, {formatEgp(savedNet.saved)}, was typed by hand. Saving now uses the calculated {formatEgp(savedNet.calculated)}.
            </p>
          )}
          <p className="hint">
            Calculated as the Ministry of Finance&apos;s salary tax system does: social insurance on the insured wage, salary tax in Law 7/2024&apos;s brackets,
            and the Martyrs&apos; Fund. Assumes the full gross, including the variable part, is paid. Uses the insurable wage limits for {year}, the year the
            contract starts.
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
