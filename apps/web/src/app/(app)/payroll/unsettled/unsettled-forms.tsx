'use client';

import { useEffect, useRef } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { focusFirstField, useClosesOnSave } from '../../employees/[id]/contracts/contract-buttons';
import type { AdvanceRow, PersonRef } from '../adjustments/adjustments';
import { clearanceOption, METHOD_CHOICES, type ClearanceDocument } from './unsettled';

// Unsettled's forms (owner, 17 October 2026), for HR: a final settlement marked settled (the day, the amount paid, a
// note, the clearance document) or reopened; held pay recorded as paid out; an advance or loan recorded, changed or
// marked settled. Each opens in its place from a small button and closes once saved; a refused one stays open with the
// API's reason.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';

/** A button that opens a small form in its place: `fields` are the form's, `label` the button's. */
function InlineForm({
  label,
  name,
  action,
  submit,
  pendingText,
  children,
}: {
  label: string;
  /** What it is about, for screen readers: "for Nour Ali". */
  name: string;
  action: Action;
  submit: string;
  pendingText?: string;
  children: (state: FormState, fid: (name: string) => string) => React.ReactNode;
}) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();
  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {state.message && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
          {label}
          <span className="sr-only"> {name}</span>
        </button>
      </div>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label={`${label} ${name}`} className="min-w-72 space-y-3 text-left">
      <FormErrors errors={state.errors} />
      {children(state, fid)}
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={pending} pendingText={pendingText}>
          {submit}
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Close
        </button>
      </div>
    </form>
  );
}

function Note({ state, fid, label = 'Note', required = false }: { state: FormState; fid: (n: string) => string; label?: string; required?: boolean }) {
  return (
    <div>
      <label htmlFor={fid('note')} className="label">
        {label} {!required && <span className="font-normal text-muted">(optional)</span>}
      </label>
      <input id={fid('note')} name="note" required={required} maxLength={500} autoComplete="off" defaultValue={valueOf(state, 'note')} className="input" />
    </div>
  );
}

/** Marks a final settlement settled: the day (today to start with), the amount paid, a note, the clearance if any. */
export function SettleFinalForm({ action, name, today, clearances }: { action: Action; name: string; today: string; clearances: ClearanceDocument[] }) {
  return (
    <InlineForm label="Mark settled" name={name} action={action} submit="Mark settled">
      {(state, fid) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('settledOn')} className="label">
                Settled on
              </label>
              <DateInput id={fid('settledOn')} name="settledOn" required defaultValue={valueOf(state, 'settledOn', formatDate(today))} />
            </div>
            <div>
              <label htmlFor={fid('amountPaid')} className="label">
                Amount paid (EGP)
              </label>
              <input
                id={fid('amountPaid')}
                name="amountPaid"
                required
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 18500.00"
                defaultValue={valueOf(state, 'amountPaid')}
                className="input tabular-nums"
              />
            </div>
          </div>
          {clearances.length > 0 && (
            <div>
              <label htmlFor={fid('documentId')} className="label">
                Clearance and dues document <span className="font-normal text-muted">(optional)</span>
              </label>
              <Select id={fid('documentId')} name="documentId" defaultValue={valueOf(state, 'documentId', clearances[0].id)} className="input">
                <option value="">None</option>
                {clearances.map((d) => (
                  <option key={d.id} value={d.id}>
                    {clearanceOption(d)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Note state={state} fid={fid} />
        </>
      )}
    </InlineForm>
  );
}

/** Reopens a final settlement marked settled by mistake: why. */
export function ReopenFinalForm({ action, name }: { action: Action; name: string }) {
  return (
    <InlineForm label="Reopen" name={name} action={action} submit="Reopen">
      {(state, fid) => (
        <div>
          <label htmlFor={fid('reason')} className="label">
            Why it is reopened
          </label>
          <input id={fid('reason')} name="reason" required maxLength={500} autoComplete="off" defaultValue={valueOf(state, 'reason')} className="input" />
        </div>
      )}
    </InlineForm>
  );
}

/** Records held pay as paid out: the day (today to start with), how, a note. */
export function PaidOutForm({ action, name, today }: { action: Action; name: string; today: string }) {
  return (
    <InlineForm label="Mark paid out" name={name} action={action} submit="Mark paid out">
      {(state, fid) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('paidOn')} className="label">
                Paid out on
              </label>
              <DateInput id={fid('paidOn')} name="paidOn" required defaultValue={valueOf(state, 'paidOn', formatDate(today))} />
            </div>
            <div>
              <label htmlFor={fid('method')} className="label">
                How
              </label>
              <Select id={fid('method')} name="method" required defaultValue={valueOf(state, 'method', 'bank_transfer')} className="input">
                {METHOD_CHOICES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Note state={state} fid={fid} />
        </>
      )}
    </InlineForm>
  );
}

/** Marks an advance or loan settled with something outstanding: how (e.g. paid back in cash). */
export function SettleAdvanceForm({ action, name }: { action: Action; name: string }) {
  return (
    <InlineForm label="Mark settled" name={name} action={action} submit="Mark settled">
      {(state, fid) => <Note state={state} fid={fid} label="How it was settled" required />}
    </InlineForm>
  );
}

/** The amount, the day it was given, the reason and the plan: as both advance forms ask them. */
function AdvanceFields({ state, fid, advance, today }: { state: FormState; fid: (n: string) => string; advance: AdvanceRow | null; today: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
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
          placeholder="e.g. 6000.00"
          defaultValue={valueOf(state, 'amount', advance ? advance.amount.toFixed(2) : '')}
          className="input tabular-nums"
        />
      </div>
      <div>
        <label htmlFor={fid('givenOn')} className="label">
          Given on
        </label>
        <DateInput id={fid('givenOn')} name="givenOn" required defaultValue={valueOf(state, 'givenOn', formatDate(advance?.givenOn ?? today))} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={fid('reason')} className="label">
          Reason
        </label>
        <input id={fid('reason')} name="reason" required maxLength={500} autoComplete="off" defaultValue={valueOf(state, 'reason', advance?.reason)} className="input" />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={fid('plan')} className="label">
          Plan <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={fid('plan')}
          name="plan"
          maxLength={200}
          autoComplete="off"
          placeholder="e.g. 6 installments of 1,000"
          defaultValue={valueOf(state, 'plan', advance?.plan)}
          aria-describedby={fid('plan-hint')}
          className="input"
        />
        <p id={fid('plan-hint')} className="hint">
          Recovered by deductions on Additions / Deductions: an advance recovery or a loan installment, each linked to it.
        </p>
      </div>
    </div>
  );
}

/** Changes an open advance or loan. */
export function EditAdvanceForm({ action, advance, today }: { action: Action; advance: AdvanceRow; today: string }) {
  return (
    <InlineForm label="Edit" name={`the ${advance.kind} of ${advance.employee.name}`} action={action} submit="Save">
      {(state, fid) => <AdvanceFields state={state} fid={fid} advance={advance} today={today} />}
    </InlineForm>
  );
}

/** Records a new advance or loan; the fields are emptied once it is recorded, for the next one. */
export function NewAdvanceForm({ action, people, today }: { action: Action; people: (PersonRef & { department: string | null })[]; today: string }) {
  const { state, pending, form } = useKeptForm(action);
  const ref = useRef<HTMLFormElement>(null);
  const fid = useFieldIds();
  useEffect(() => {
    if (state.message) ref.current?.reset();
  }, [state]);
  return (
    <form {...form} ref={ref} aria-label="Record an advance or loan" className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('employeeId')} className="label">
            Employee
          </label>
          <Select id={fid('employeeId')} name="employeeId" required defaultValue={valueOf(state, 'employeeId', '')} className="input">
            <option value="">Choose…</option>
            {people.map((p) => (
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
            {(
              [
                ['advance', 'Advance'],
                ['loan', 'Loan'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="inline-flex min-h-11 items-center gap-2">
                <input type="radio" name="kind" value={value} required defaultChecked={valueOf(state, 'kind', 'advance') === value} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <AdvanceFields state={state} fid={fid} advance={null} today={today} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending} pendingText="Recording…">
          Record
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
