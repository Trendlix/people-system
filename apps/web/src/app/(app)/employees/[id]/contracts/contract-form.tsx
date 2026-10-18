'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  CONTRACT_FORM_LABELS,
  CONTRACT_FORMS,
  lawRatesFor,
  RAISE_REASON_LABELS,
  raiseReasonOptions,
  traineeMonths,
  type ContractForm as Length,
  type LawRates,
  type PayTerms as VersionPay,
  type RaiseReason,
} from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate, parseDate } from '@/lib/format';
import type { AllowanceType, FormState } from '@/lib/types';
import { OPEN_ENDED_NOTE, SPECIFIC_JOB_NOTE } from '../../employment-law';
import { contractEnd, probationEnd } from './dates';
import { choice, PayFields, typedPayOf, usePay, type PayDefaults } from './pay-fields';
import { payChangeWarning } from './raise';
import { stageRows, stagesOf, type SavedStage, type StageRow } from './trainee-stages';
import { TraineeStagesEditor } from './trainee-stages-editor';

// The form of the New contract, Renew and Edit draft pages. While HR types, it shows when the contract ends, when
// probation ends, and the pay (pay-fields.tsx): the basic and variable parts of the gross, for a full-time contract the
// insured salary on the social insurance copy, and the salary's breakdown down to the net. The API works the dates and
// parts out again when it saves.
//
// Its length (owner, 18 October 2026: "can we update the employment types based on the labour law?"; on 15 October every
// contract was fixed-term): fixed-term, the default, for its months (12 to start with); open-ended, with no end date and
// no renewal, ended by notice (Labour Law Art. 156); or for a specific job, named in The job, with its expected end date
// if known (Art. 155). A trainee's contract is the training agreement (Arts. 28–30): its length is its training stages'
// months, each stage with its pay (trainee-stages-editor.tsx), and its gross the first stage's pay.
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
  /** Fixed-term unless the draft (or the version renewed) is another. */
  form: Length;
  durationMonths: number;
  /** For a specific job: the job, and the expected end date ('' for none). */
  jobToDo: string;
  endDate: string;
  probationMonths: number;
  /** A trainee's training stages; null for none yet (or not a trainee). */
  traineeStages: SavedStage[] | null;
  note: string;
};

/** What Contract length says under each choice. */
const LENGTH_HINTS: Record<Length, string> = {
  fixed: 'For a set number of months, renewed in writing before it ends. Carried on after its end without a written renewal, the law counts it as open-ended (Labour Law Art. 88).',
  open_ended: OPEN_ENDED_NOTE,
  specific_job: SPECIFIC_JOB_NOTE,
};

const lengthOf = (value: string): Length => ((CONTRACT_FORMS as readonly string[]).includes(value) ? (value as Length) : 'fixed');

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
  employmentType: employmentTypeProp,
  dateOfBirth,
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
  /**
   * The employment's type: a full-time contract has a social insurance copy, whose salary is the insured salary; a
   * trainee's is the training agreement, with its stages. Hiring in one form, the type chosen with the job instead.
   */
  employmentType: string;
  /** The person's date of birth (YYYY-MM-DD), for a trainee's age (at least 14, Art. 28); null when not recorded. */
  dateOfBirth: string | null;
  /** YYYY-MM-DD, for the salary's year (its rates set by law) while there is no start date. */
  today: string;
  /** The rates set by law of each year kept (GET /payroll/law-rates, else the built-in ones): the salary's year's are used. */
  lawYears: readonly LawRates[];
  /**
   * Hiring in one form (Add employment; owner's decision, 16 October 2026): the job's fields, above the contract's terms
   * in the same form and saved with them. The contract then starts on the join date typed there (no start date is
   * asked), and its kind follows the employment type chosen there rather than `employmentType`.
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
    form: valueOf(state, 'form', defaults.form),
    durationMonths: valueOf(state, 'durationMonths', String(defaults.durationMonths)),
    // for a specific job, kept while another length is tried
    jobToDo: valueOf(state, 'jobToDo', defaults.jobToDo),
    endDate: valueOf(state, 'endDate', formatDate(defaults.endDate)),
    probationMonths: valueOf(state, 'probationMonths', String(defaults.probationMonths)),
    // hiring in one form: the job's join date and employment type, typed above the contract's terms
    joinDate: valueOf(state, 'joinDate', ''),
    employmentType: valueOf(state, 'employmentType', ''),
    // a renewal: whether the pay changes
    payChange: valueOf(state, 'payChange', payChange?.changes ? 'changes' : 'same'),
  }));

  // a trainee's training stages, as typed (the editor reports them): the gross and the length follow them
  const [stages, setStages] = useState<StageRow[]>(() => stageRows(state, defaults.traineeStages));

  // hiring in one form, the contract starts on the join date typed with the job, and its kind follows the employment type
  const start = renewal ? renewal.startDate : parseDate(job ? typed.joinDate : typed.startDate) || null;
  const type = job ? typed.employmentType : employmentTypeProp;
  const fullTime = type === 'full_time';
  const trainee = type === 'trainee';
  // a training agreement runs for its stages, one after the other: a fixed term of their months
  const length = trainee ? 'fixed' : lengthOf(typed.form);
  const trainingMonths = traineeMonths(stagesOf(stages));
  const months = trainee ? trainingMonths : Number(typed.durationMonths);
  const end =
    length === 'fixed'
      ? start && Number.isInteger(months) && months >= 1
        ? contractEnd(start, months)
        : null
      : length === 'specific_job'
        ? parseDate(typed.endDate) || null
        : null;
  const probation = renewal ? 0 : Number(typed.probationMonths);
  const probationEnds = start && Number.isInteger(probation) && probation > 0 && probation <= 3 ? probationEnd(start, probation) : null;
  // the salary, with the rates set by law of the year the contract starts (this year while there is no start date)
  const year = Number((start ?? today).slice(0, 4));
  const rates = lawRatesFor(year, lawYears);
  const pay = usePay(state, defaults, allowanceTypes, rates, trainee ? (stages[0]?.pay ?? '') : null);
  const answer = answerOf(typed.payChange);
  const payWarning = payChange && payChangeWarning(answer, typedPayOf(pay), payChange.pay, payChange.version);

  function track(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target;
    if (!((t instanceof HTMLInputElement || t instanceof HTMLSelectElement) && t.name)) return;
    const { name, value } = t;
    // the allowance rows and the training stages report their changes through onChange
    if (name === 'allowanceTypeId' || name === 'allowanceAmount' || name.startsWith('traineeStage')) return;
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

      {trainee ? (
        // the training agreement: its length is its stages' months, one after the other (not sent: worked out from them)
        <div className="space-y-2">
          <input type="hidden" name="form" value="fixed" />
          <TraineeStagesEditor
            state={state}
            fid={fid}
            saved={defaults.traineeStages}
            minimumWage={typeof rates.minimumWage === 'number' ? rates.minimumWage : null}
            dateOfBirth={dateOfBirth}
            startDate={start}
            onChange={setStages}
          />
          {end && <p className="text-sm">The training agreement ends on {formatDate(end)}, after its last stage.</p>}
        </div>
      ) : (
        <fieldset className="space-y-4" aria-describedby={fid('form-hint')}>
          <legend className="label">Contract length</legend>
          <div className="flex flex-wrap gap-2">
            {CONTRACT_FORMS.map((f) => (
              <label key={f} className={choice}>
                <input type="radio" name="form" value={f} defaultChecked={length === f} className="size-4 accent-accent" />
                {f === 'fixed' ? `${CONTRACT_FORM_LABELS.fixed} (the default)` : CONTRACT_FORM_LABELS[f]}
              </label>
            ))}
          </div>
          <p id={fid('form-hint')} className="hint">
            {LENGTH_HINTS[length]}
          </p>
          {length === 'fixed' && (
            <div className="sm:max-w-[calc(50%-0.625rem)]">
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
          )}
          {length === 'specific_job' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor={fid('jobToDo')} className="label">
                  The job
                </label>
                <input
                  id={fid('jobToDo')}
                  name="jobToDo"
                  required
                  maxLength={500}
                  autoComplete="off"
                  aria-describedby={fid('jobToDo-hint')}
                  defaultValue={typed.jobToDo}
                  className="input"
                />
                <p id={fid('jobToDo-hint')} className="hint">
                  What the contract is for, as the contract names it, e.g. &quot;Building the new website&quot;.
                </p>
              </div>
              <div>
                <label htmlFor={fid('endDate')} className="label">
                  Expected end date {optional}
                </label>
                <DateInput id={fid('endDate')} name="endDate" aria-describedby={fid('endDate-hint')} defaultValue={typed.endDate} />
                <p id={fid('endDate-hint')} className="hint">
                  When the job should be done, if known. The contract ends when it is done.
                </p>
              </div>
            </div>
          )}
        </fieldset>
      )}

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
                    {raiseReasonOptions(payChange.reason).map((r) => (
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
