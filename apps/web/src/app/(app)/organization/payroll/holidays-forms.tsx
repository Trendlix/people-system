'use client';

import { useEffect, useRef } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { FormState, Holiday } from '@/lib/types';
import { ActionButton, focusFirstField, useClosesOnSave } from '../../employees/[id]/contracts/contract-buttons';
import { weekdayOf } from './settings';

// Payroll Setup → Holidays and Working Days (owner's request, 16 October 2026): the year's official holidays, one day
// each. HR and Admin add one and change its day or names; a Super Admin removes one (every deletion is theirs: owner's
// decision, 15 October 2026). Runs made or refreshed afterwards count a change.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';

/** A holiday as listed: its day and weekday, and its names. */
export function HolidayText({ holiday }: { holiday: Holiday }) {
  return (
    <div className="min-w-0">
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{formatDate(holiday.date)}</span>
        <span className="text-muted"> · {weekdayOf(holiday.date)}</span>
      </p>
      <p className="text-sm">
        {holiday.nameEn}
        {holiday.nameAr && (
          <>
            <span className="text-muted"> · </span>
            <bdi lang="ar" dir="rtl">
              {holiday.nameAr}
            </bdi>
          </>
        )}
      </p>
    </div>
  );
}

/** The day and the names, as both forms ask for them. */
function HolidayFields({ state, holiday }: { state: FormState; holiday: Holiday | null }) {
  const fid = useFieldIds();
  return (
    <div className="grid gap-4 sm:grid-cols-[11rem_1fr_1fr]">
      <div>
        <label htmlFor={fid('date')} className="label">
          Date
        </label>
        <DateInput id={fid('date')} name="date" required defaultValue={valueOf(state, 'date', formatDate(holiday?.date))} />
      </div>
      <div>
        <label htmlFor={fid('nameEn')} className="label">
          Name in English
        </label>
        <input id={fid('nameEn')} name="nameEn" required maxLength={100} autoComplete="off" defaultValue={valueOf(state, 'nameEn', holiday?.nameEn)} className="input" />
      </div>
      <div>
        <label htmlFor={fid('nameAr')} className="label">
          Name in Arabic <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={fid('nameAr')}
          name="nameAr"
          maxLength={100}
          autoComplete="off"
          dir="rtl"
          lang="ar"
          defaultValue={valueOf(state, 'nameAr', holiday?.nameAr)}
          className="input"
        />
      </div>
    </div>
  );
}

/** A new holiday; the fields are emptied once it is added, for the next one. */
export function AddHolidayForm({ action }: { action: Action }) {
  const { state, pending, form } = useKeptForm(action);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.message) ref.current?.reset();
  }, [state]);

  return (
    <form {...form} ref={ref} aria-label="Add a holiday" className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <HolidayFields state={state} holiday={null} />
      <p className="hint">One day each: add every day of a holiday that runs several days, such as Eid al-Adha.</p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending} pendingText="Adding…">
          Add holiday
        </SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/** A holiday HR or Admin can change (and a Super Admin remove): its Edit form opens in its place. */
export function EditableHoliday({ holiday, action, remove }: { holiday: Holiday; action: Action; remove: ((prev: FormState) => Promise<FormState>) | null }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const name = `${holiday.nameEn} on ${formatDate(holiday.date)}`;

  if (!open) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HolidayText holiday={holiday} />
        <div className="flex flex-wrap items-start gap-2">
          {state.message && (
            <p role="status" className="self-center text-sm text-ok">
              {state.message}
            </p>
          )}
          <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
            Edit<span className="sr-only"> {name}</span>
          </button>
          {remove && (
            <ActionButton
              action={remove}
              pendingText="Removing…"
              variant="danger"
              confirmText={`Remove ${name}? Runs made or refreshed afterwards no longer count it; approved runs keep what they were worked out with.`}
            >
              Remove<span className="sr-only"> {name}</span>
            </ActionButton>
          )}
        </div>
      </div>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label={`Edit ${name}`} className="space-y-3">
      <FormErrors errors={state.errors} />
      <HolidayFields state={state} holiday={holiday} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>Save</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
