'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdjustmentKind } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { ActionButton, focusFirstField, useClosesOnSave } from '../../employees/[id]/contracts/contract-buttons';
import {
  advanceOption,
  advancesFor,
  asksDays,
  asksTaxed,
  DAYS_HINTS,
  KIND_CHOICES,
  linksAdvance,
  typeChoices,
  type AdjustmentChoices,
  type AdjustmentRow,
  type AdvanceRow,
} from './adjustments';

// Additions / Deductions' forms (owner, 17 October 2026): HR adds an addition or a deduction for someone employed in the
// month, and changes or cancels a pending one while the month's run is still a draft. The form asks only what the type
// needs: whether an Other addition is taxed, for an advance's recovery or a loan's installment which one, and for a
// Bonus (days) or a Penalty (days) its days in place of an amount (owner, 17 October 2026: the run's grid columns moved
// here), the month's run working the amount out. The API checks everything again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';

/** The type, whether it is taxed (Other only), the amount, the reason and the advance or loan: as both forms ask them. */
function Fields({
  state,
  kind,
  employeeId,
  advances,
  row,
  months,
  month,
}: {
  state: FormState;
  kind: AdjustmentKind;
  employeeId: string;
  advances: readonly AdvanceRow[];
  row: AdjustmentRow | null;
  /** Changing one: the months it can be moved to. */
  months: { value: string; label: string }[] | null;
  month: string;
}) {
  const fid = useFieldIds();
  const types = typeChoices(kind);
  const [type, setType] = useState(valueOf(state, 'type', row?.type ?? types[0].value));
  // a type of the other kind (the kind was switched) reads as the kind's first
  const chosen = types.some((t) => t.value === type) ? type : types[0].value;
  const advanceKind = linksAdvance(kind, chosen);
  const linkable = advancesFor(advances, employeeId, advanceKind);
  const taxedNote = types.find((t) => t.value === chosen)?.taxed;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {months ? (
        <div>
          <label htmlFor={fid('month')} className="label">
            Month
          </label>
          <Select id={fid('month')} name="month" defaultValue={valueOf(state, 'month', month)} className="input">
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="month" value={month} />
      )}
      <div>
        <label htmlFor={fid('type')} className="label">
          Type
        </label>
        <Select id={fid('type')} name="type" required value={chosen} onChange={(e) => setType(e.target.value)} aria-describedby={fid('type-hint')} className="input">
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <p id={fid('type-hint')} className="hint">
          {kind === 'deduction' ? 'Taken after tax.' : taxedNote === null ? 'Choose below whether it is taxed.' : taxedNote ? 'Taxed with the pay.' : 'Not taxed: added after tax.'}
        </p>
      </div>
      {asksTaxed(kind, chosen) && (
        <fieldset className="sm:col-span-2">
          <legend className="label">Taxed</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(
              [
                ['yes', 'Yes, taxed with the pay'],
                ['no', 'No, added after tax'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="inline-flex min-h-11 items-center gap-2">
                <input type="radio" name="taxed" value={value} required defaultChecked={valueOf(state, 'taxed', row ? (row.taxed ? 'yes' : 'no') : '') === value} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {asksDays(chosen) ? (
        <div>
          <label htmlFor={fid('days')} className="label">
            Days
          </label>
          <input
            id={fid('days')}
            name="days"
            required
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 2 or 1.5"
            defaultValue={valueOf(state, 'days', typeof row?.days === 'number' ? String(row.days) : '')}
            aria-describedby={fid('days-hint')}
            className="input tabular-nums"
          />
          <p id={fid('days-hint')} className="hint">
            Whole or half days, up to 31. {DAYS_HINTS[chosen]}
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor={fid('amount')} className="label">
            Amount (EGP)
          </label>
          <input
            id={fid('amount')}
            name="amount"
            required
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 1500.00"
            defaultValue={valueOf(state, 'amount', row?.amount !== null && row?.amount !== undefined && !asksDays(row.type) ? row.amount.toFixed(2) : '')}
            className="input tabular-nums"
          />
        </div>
      )}
      {advanceKind && (
        <div>
          <label htmlFor={fid('advanceId')} className="label">
            {advanceKind === 'loan' ? 'Loan' : 'Advance'} it recovers
          </label>
          <Select id={fid('advanceId')} name="advanceId" required defaultValue={valueOf(state, 'advanceId', row?.advance?.id ?? '')} className="input">
            <option value="">{linkable.length ? 'Choose…' : `No open ${advanceKind} for this person`}</option>
            {linkable.map((a) => (
              <option key={a.id} value={a.id}>
                {advanceOption(a)}
              </option>
            ))}
          </Select>
          <p className="hint">Advances and loans are recorded on Unsettled.</p>
        </div>
      )}
      <div className="sm:col-span-2">
        <label htmlFor={fid('reason')} className="label">
          Reason
        </label>
        <input id={fid('reason')} name="reason" required maxLength={500} autoComplete="off" defaultValue={valueOf(state, 'reason', row?.reason)} className="input" />
      </div>
    </div>
  );
}

/**
 * A new addition or deduction for the month; emptied once it is added, for the next one. `employeeId`: the person whose
 * month is shown (opened from the run's grid), chosen to start with and kept for the next one.
 */
export function AddAdjustmentForm({ action, choices, employeeId: shown = null }: { action: Action; choices: AdjustmentChoices; employeeId?: string | null }) {
  const { state, pending, form } = useKeptForm(action);
  const ref = useRef<HTMLFormElement>(null);
  const fid = useFieldIds();
  const [kind, setKind] = useState<AdjustmentKind>(valueOf(state, 'kind', 'addition') === 'deduction' ? 'deduction' : 'addition');
  const [employeeId, setEmployeeId] = useState(valueOf(state, 'employeeId', shown ?? ''));
  // the fields start afresh after each one added
  const [round, setRound] = useState(0);
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state.message) {
      setEmployeeId(shown ?? '');
      setRound((n) => n + 1);
    }
  }
  useEffect(() => {
    if (state.message) ref.current?.reset();
  }, [state]);

  return (
    <form {...form} ref={ref} aria-label="Add an addition or deduction" className="space-y-4 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('employeeId')} className="label">
            Employee
          </label>
          <Select id={fid('employeeId')} name="employeeId" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="input">
            <option value="">Choose…</option>
            {choices.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.employeeCode}
                {p.department ? ` · ${p.department}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <fieldset>
          <legend className="label">Kind</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {KIND_CHOICES.map((k) => (
              <label key={k.value} className="inline-flex min-h-11 items-center gap-2">
                <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <Fields key={`${kind}-${round}`} state={state} kind={kind} employeeId={employeeId} advances={choices.advances} row={null} months={null} month={choices.month} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending} pendingText="Adding…">
          Add {kind}
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

/** A pending one HR can change or cancel: its Edit form opens in its place. */
export function AdjustmentActions({
  row,
  action,
  cancel,
  months,
  advances,
}: {
  row: AdjustmentRow;
  action: Action;
  cancel: (prev: FormState) => Promise<FormState>;
  months: { value: string; label: string }[];
  advances: readonly AdvanceRow[];
}) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const what = `${row.kind} for ${row.employee.name}`;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {state.message && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
          Edit<span className="sr-only"> the {what}</span>
        </button>
        <ActionButton action={cancel} pendingText="Cancelling…" variant="danger" confirmText={`Cancel this ${what}? It stays on record, left out of the month's totals.`}>
          Cancel<span className="sr-only"> the {what}</span>
        </ActionButton>
      </div>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label={`Edit the ${what}`} className="space-y-3 text-left">
      <FormErrors errors={state.errors} />
      <input type="hidden" name="currentKind" value={row.kind} />
      <Fields state={state} kind={row.kind} employeeId={row.employee.id} advances={withOwn(advances, row)} row={row} months={months} month={row.month} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={pending}>Save</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Close
        </button>
      </div>
    </form>
  );
}

/** The open advances, with the one this row recovers made room for: its own amount is free again when it is changed. */
function withOwn(advances: readonly AdvanceRow[], row: AdjustmentRow): AdvanceRow[] {
  return advances.map((a) => (a.id === row.advance?.id ? { ...a, unplanned: Math.round((a.unplanned + (row.amount ?? 0)) * 100) / 100 } : a));
}

/**
 * Moves one, or all the month's pending ones, left on a month approved without them to a later month (owner, 17
 * October 2026): the month to start with the first one offered, the next.
 */
export function MoveForm({ action, months, label, what }: { action: Action; months: { value: string; label: string }[]; label: string; what: string }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  // the next month first: the list is newest first
  const next = months.at(-1)?.value ?? '';
  if (!months.length) return null;
  return (
    <form {...form} aria-label={`${label} ${what}`} className="space-y-2">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end justify-end gap-2">
        <div>
          <label htmlFor={fid('month')} className="sr-only">
            Month to move {what} to
          </label>
          <Select id={fid('month')} name="month" defaultValue={valueOf(state, 'month', next)} className="input min-h-9 py-1">
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <SubmitButton busy={pending} pendingText="Moving…">
          {label}
        </SubmitButton>
      </div>
      {state.message && !pending && (
        <p role="status" className="text-right text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}
