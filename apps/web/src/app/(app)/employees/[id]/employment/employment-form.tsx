'use client';

import Link from 'next/link';
import { END_REASON_LABELS, END_REASONS } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { Employment, FormState } from '@/lib/types';
import { EmploymentFields, type EmploymentPickers } from '../../employment-fields';

// The forms of the Add employment, Edit employment and Record a past ending pages.

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
        <select
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
        </select>
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

/**
 * Adding an employment (`employment` left out) or changing one. A current one has a status; an ended one has, instead,
 * the end date, reason and note, which can be corrected here.
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
          The date the employee signed their job description{employment?.jobTitle ? ` (version ${employment.jobTitle.jdVersion})` : ''}. Leave
          empty until then.
        </p>
      </div>
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
