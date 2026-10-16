'use client';

import Link from 'next/link';
import { useState } from 'react';
import { lawRatesFor, RAISE_REASON_LABELS, RAISE_REASONS, type LawRates, type PayTerms as VersionPay, type RaiseReason } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate, parseDate } from '@/lib/format';
import type { AllowanceType, FormState } from '@/lib/types';
import { contractEnd, probationEnd } from './dates';
import { choice, PayFields, typedPayOf, usePay, type PayDefaults } from './pay-fields';
import { payChangeWarning } from './raise';

// The form of the New contract, Renew and Edit draft pages. While HR types, it shows when the contract ends, when
// probation ends, and the pay (pay-fields.tsx): the basic and variable parts of the gross, for a full-time contract the
// insured salary on the social insurance copy, and the salary's breakdown down to the net. The API works the dates and
// parts out again when it saves. Every contract runs for a fixed term (owner, 15 October 2026: no open-ended contracts),
// so only its length is asked.
//
// The rates set by law are those of the year the contract starts (owner's request, 16 October 2026: the Super Admin
// keeps them by year in Organization → Payroll), from the years the page loaded (`lawYears`).
//
// A renewal asks whether its pay changes (owner's decisions, 16 October 2026: a renewal whose pay changes counts as a
// raise): with the same pay it starts from the version renewed and needs no approval, as before; when the pay changes,
// why (required), and the CEO approves it before it is signed.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** What the form starts with: the draft being changed, the version renewed, or the settings and defaults. Dates are YYYY-MM-DD. */
export type ContractDefaults = PayDefaults & {
  startDate: string;
  durationMonths: number;
  probationMonths: number;
  note: string;
};

/** A renewal's answers to "Does the pay change?". */
const PAY_CHANGE_ANSWERS = { same: 'Same pay', changes: 'The pay changes' } as const;
type PayChangeAnswer = keyof typeof PAY_CHANGE_ANSWERS;
const answerOf = (value: string): PayChangeAnswer => (value === 'changes' ? 'changes' : 'same');

const optional = <span className="font-normal text-muted">(optional)</span>;

export function ContractForm({
  action,
  defaults,
  allowanceTypes,
  renewal,
  payChange,
  probationHint,
  fullTime: fullTimeProp,
  today,
  lawYears,
  job,
  cancelHref,
  submitLabel,
}: {
  action: Action;
  defaults: ContractDefaults;
  /** The kinds of allowance (GET /allowance-types), the inactive ones too: those already on the contract stay shown. */
  allowanceTypes: readonly AllowanceType[];
  /** A renewal starts the day after the version before it ends (`startDate`, null when unknown), without probation. */
  renewal: { startDate: string | null; after: string } | null;
  /**
   * A renewal's pay against the version it renews (`version`, its `pay`): whether it changes to start with, and why
   * (owner's decisions, 16 October 2026). A change of pay is a raise, which the CEO approves before it is signed.
   */
  payChange?: { version: number; pay: VersionPay; changes: boolean; reason: RaiseReason | null };
  /** Why the probation starts as it does, e.g. someone who already had probation with the company. */
  probationHint?: string;
  /** Full-time contracts have a social insurance copy, whose salary is the insured salary. */
  fullTime: boolean;
  /** YYYY-MM-DD, for the salary's year (its rates set by law) while there is no start date. */
  today: string;
  /** The rates set by law of each year kept (GET /payroll/law-rates, else the built-in ones): the salary's year's are used. */
  lawYears: readonly LawRates[];
  /**
   * Hiring in one form (Add employment; owner's decision, 16 October 2026): the job's fields, above the contract's terms
   * in the same form and saved with them. The contract then starts on the join date typed there (no start date is
   * asked), and its kind follows the employment type chosen there rather than `fullTime`.
   */
  job?: (state: FormState, fid: (name: string) => string) => React.ReactNode;
  cancelHref: string;
  submitLabel: string;
}) {
  // Kept form: a refused save leaves everything as typed and chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  // What is typed, for the previews (the fields themselves stay uncontrolled); the pay fields keep their own (usePay).
  const [typed, setTyped] = useState<Record<string, string>>(() => ({
    startDate: valueOf(state, 'startDate', formatDate(defaults.startDate)),
    durationMonths: valueOf(state, 'durationMonths', String(defaults.durationMonths)),
    probationMonths: valueOf(state, 'probationMonths', String(defaults.probationMonths)),
    // hiring in one form: the job's join date and employment type, typed above the contract's terms
    joinDate: valueOf(state, 'joinDate', ''),
    employmentType: valueOf(state, 'employmentType', ''),
    // a renewal: whether the pay changes
    payChange: valueOf(state, 'payChange', payChange?.changes ? 'changes' : 'same'),
  }));

  // hiring in one form, the contract starts on the join date typed with the job, and its kind follows the employment type
  const start = renewal ? renewal.startDate : parseDate(job ? typed.joinDate : typed.startDate) || null;
  const fullTime = job ? typed.employmentType === 'full_time' : fullTimeProp;
  const months = Number(typed.durationMonths);
  const end = start && Number.isInteger(months) && months >= 1 ? contractEnd(start, months) : null;
  const probation = renewal ? 0 : Number(typed.probationMonths);
  const probationEnds = start && Number.isInteger(probation) && probation > 0 && probation <= 3 ? probationEnd(start, probation) : null;
  // the salary, with the rates set by law of the year the contract starts (this year while there is no start date)
  const year = Number((start ?? today).slice(0, 4));
  const pay = usePay(state, defaults, allowanceTypes, lawRatesFor(year, lawYears));
  const answer = answerOf(typed.payChange);
  const payWarning = payChange && payChangeWarning(answer, typedPayOf(pay), payChange.pay, payChange.version);

  function track(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target;
    if (!((t instanceof HTMLInputElement || t instanceof HTMLSelectElement) && t.name)) return;
    const { name, value } = t;
    // the allowance rows report their changes through onChange
    if (name === 'allowanceTypeId' || name === 'allowanceAmount') return;
    if (pay.track(name, value)) return;
    setTyped((v) => ({ ...v, [name]: value }));
  }

  return (
    <form {...form} onChange={track} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />

      {job && (
        <>
          <h2 className="font-semibold">Job</h2>
          {job(state, fid)}
          <h2 className="border-t border-line pt-6 font-semibold">Contract</h2>
        </>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('startDate')} className="label">
            Start date
          </label>
          {renewal || job ? (
            // not sent: a renewal starts the day after the version before it ends, a hire's first contract on the join date
            <input
              id={fid('startDate')}
              value={renewal ? (renewal.startDate ? formatDate(renewal.startDate) : 'The day after the current version ends') : start ? formatDate(start) : 'The join date'}
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
              : job
                ? 'The first contract starts on the join date.'
                : 'The join date, unless the contract starts later. Leave empty for the join date.'}
          </p>
        </div>

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
            {end ? `Ends on ${formatDate(end)}.` : start ? 'Enter the length to see when it ends.' : 'Enter the start date to see when it ends.'} Every
            contract is for a fixed term, renewed in writing before it ends.
          </p>
        </div>

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

      <PayFields
        pay={pay}
        state={state}
        fid={fid}
        allowanceTypes={allowanceTypes}
        fullTime={fullTime}
        year={year}
        yearIs="the year the contract starts"
        lead={
          payChange && (
            <div className="space-y-5">
              <fieldset aria-describedby={`${fid('payChange-hint')}${payWarning ? ` ${fid('payChange-warning')}` : ''}`}>
                <legend className="label">Does the pay change?</legend>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(PAY_CHANGE_ANSWERS) as PayChangeAnswer[]).map((a) => (
                    <label key={a} className={choice}>
                      <input type="radio" name="payChange" value={a} defaultChecked={answer === a} className="size-4 accent-accent" />
                      {PAY_CHANGE_ANSWERS[a]}
                    </label>
                  ))}
                </div>
                <p id={fid('payChange-hint')} className="hint">
                  {answer === 'changes'
                    ? 'A renewal with new pay counts as a raise: the CEO approves it before it is signed. Once saved, send it to the CEO with the contract on the Employment tab.'
                    : `The pay of version ${payChange.version}, as below. A renewal with the same pay needs no approval.`}
                </p>
                <div role="status">
                  {payWarning && (
                    <p id={fid('payChange-warning')} className="hint text-warn">
                      {payWarning}
                    </p>
                  )}
                </div>
              </fieldset>
              {answer === 'changes' && (
                <div className="max-w-sm">
                  <label htmlFor={fid('raiseReason')} className="label">
                    Why the pay changes
                  </label>
                  <Select
                    id={fid('raiseReason')}
                    name="raiseReason"
                    required
                    aria-describedby={fid('raiseReason-hint')}
                    defaultValue={valueOf(state, 'raiseReason', payChange.reason ?? '')}
                    className="input"
                  >
                    <option value="">Choose a reason</option>
                    {RAISE_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {RAISE_REASON_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  <p id={fid('raiseReason-hint')} className="hint">
                    The CEO sees it with the change of pay.
                  </p>
                </div>
              )}
            </div>
          )
        }
      />

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
