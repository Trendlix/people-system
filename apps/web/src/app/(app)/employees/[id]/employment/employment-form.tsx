'use client';

import Link from 'next/link';
import { END_REASON_LABELS, END_REASONS } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import type { Employment, FormState } from '@/lib/types';
import { EmploymentFields, type EmploymentPickers } from '../../employment-fields';
import { ContractForm } from '../contracts/contract-form';

// The forms of the Add employment, Edit employment and Record a past ending pages. Add employment hires in one form
// (owner's decision, 16 October 2026: "there is no point of adding employment then adding contract"): the job, then the
// first contract's terms, saved together; editing an employment later is the job only, as its contract changes through
// its own versions.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** How an employment ended: the last working day, why, and a note. On the End page, and on an ended one's Edit page. */
function EndFields({ state, fid, employment }: { state: FormState; fid: (name: string) => string; employment?: Employment }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor={fid('endDate')} className="label">
          Last working day
        </label>
        <DateInput id={fid('endDate')} name="endDate" required defaultValue={valueOf(state, 'endDate', formatDate(employment?.endDate))} />
      </div>
      <div>
        <label htmlFor={fid('endReason')} className="label">
          Reason
        </label>
        <Select
          id={fid('endReason')}
          name="endReason"
          required
          aria-describedby={fid('endReason-hint')}
          defaultValue={valueOf(state, 'endReason', employment?.endReason)}
          className="input"
        >
          <option value="">Choose a reason</option>
          {END_REASONS.map((r) => (
            <option key={r} value={r}>
              {END_REASON_LABELS[r]}
            </option>
          ))}
        </Select>
        <p id={fid('endReason-hint')} className="hint">
          Resigned gives the status Resigned; the others give Terminated.
        </p>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={fid('endNote')} className="label">
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id={fid('endNote')}
          name="endNote"
          rows={3}
          maxLength={500}
          aria-describedby={fid('endNote-hint')}
          defaultValue={valueOf(state, 'endNote', employment?.endNote)}
          className="input"
        />
        <p id={fid('endNote-hint')} className="hint">
          E.g. the handover, or what was agreed. Up to 500 characters.
        </p>
      </div>
    </div>
  );
}

/** The day the employee signed their job description; empty until then. */
function JobDescriptionField({ state, fid, employment }: { state: FormState; fid: (name: string) => string; employment?: Employment }) {
  return (
    <div className="max-w-72">
      <label htmlFor={fid('jdAcknowledgedAt')} className="label">
        Job description acknowledged on
      </label>
      <DateInput
        id={fid('jdAcknowledgedAt')}
        name="jdAcknowledgedAt"
        aria-describedby={fid('jdAcknowledgedAt-hint')}
        defaultValue={valueOf(state, 'jdAcknowledgedAt', formatDate(employment?.jdAcknowledgedAt))}
      />
      <p id={fid('jdAcknowledgedAt-hint')} className="hint">
        The date the employee signed their job description{employment?.jobTitle ? ` (version ${employment.jobTitle.jdVersion})` : ''}. Leave empty
        until then.
      </p>
    </div>
  );
}

/**
 * Hiring: the job (as Add employment always asked it) and, below it in the same form, the first contract's terms (the
 * contract form's own fields), saved in one request as the employment and its contract version 1, a draft to print and
 * sign. The contract starts on the join date, and the employment type decides its kind (full time: the social
 * insurance copy).
 */
export function HireForm({
  pickers,
  contract,
}: {
  pickers: EmploymentPickers;
  /** The contract form's props: the hire's action, the first contract's defaults, the submit label … */
  contract: Omit<React.ComponentProps<typeof ContractForm>, 'job' | 'fullTime' | 'renewal'>;
}) {
  return (
    <ContractForm
      {...contract}
      renewal={null}
      fullTime={false}
      job={(state, fid) => (
        <>
          <EmploymentFields state={state} fid={fid} pickers={pickers} contractBelow />
          <JobDescriptionField state={state} fid={fid} />
        </>
      )}
    />
  );
}

/**
 * Changing an employment, the job only: a current one has a status; an ended one has, instead, the end date, reason and
 * note, which can be corrected here. (Adding one without its contract is for a server from before hiring in one form.)
 */
export function EmploymentForm({
  action,
  pickers,
  employment,
  cancelHref,
  submitLabel,
}: {
  action: Action;
  pickers: EmploymentPickers;
  employment?: Employment;
  cancelHref: string;
  submitLabel: string;
}) {
  // Kept form: a refused save leaves the selects (type, status, manager, shift…) as they were chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />
      <EmploymentFields state={state} fid={fid} pickers={pickers} employment={employment} />
      <JobDescriptionField state={state} fid={fid} employment={employment} />
      {employment?.endDate && (
        <div className="border-t border-line pt-6">
          <fieldset className="space-y-5">
            <legend className="font-semibold">How It Ended</legend>
            <EndFields state={state} fid={fid} employment={employment} />
          </fieldset>
        </div>
      )}
      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * Recording a past ending of the current employment, directly (an HR correction tool: ending one now goes to the CEO,
 * on the End employment page): the last working day, why, and a note.
 */
export function EndEmploymentForm({ action, cancelHref }: { action: Action; cancelHref: string }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />
      <EndFields state={state} fid={fid} />
      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending} pendingText="Recording…">
          Record the ending
        </SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
