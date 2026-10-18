'use client';

import { useEffect, useRef, useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import type { AdvanceLimitView, FormState } from '@/lib/types';
import type { PersonRef } from '../adjustments/adjustments';
import { limitHref } from '../unsettled/installments';
import { InlineForm, Note } from '../unsettled/unsettled-forms';
import { NAME_MAX, recurringPreview } from './recurring';

// Recurring Deductions' forms (owner, 18 October 2026: a medical subscription is an ongoing monthly share), for HR: a
// new one for an employee (what for, the amount a month, the first month and, if it has one, the last); on each one
// running or to come, Change amount from a month, Stop from a month, and Edit its name or last month. Each opens in its
// place from a small button and closes once saved; a refused one stays open with the API's reason.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type MonthChoice = { value: string; label: string };

/** A month picker of the months given; `optional`: an empty choice first, with `emptyLabel`. */
function MonthSelect({
  id,
  name,
  months,
  value,
  required = false,
  emptyLabel,
  onChange,
}: {
  id: string;
  name: string;
  months: MonthChoice[];
  value: string;
  required?: boolean;
  emptyLabel?: string;
  /** Told each month chosen, e.g. for the figures shown as the form is filled in. */
  onChange?: (month: string) => void;
}) {
  return (
    <Select id={id} name={name} required={required} defaultValue={value} onChange={onChange && ((e) => onChange(e.target.value))} className="input">
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {months.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </Select>
  );
}

function NameField({ state, fid, saved }: { state: FormState; fid: (n: string) => string; saved?: string }) {
  return (
    <div>
      <label htmlFor={fid('name')} className="label">
        What for
      </label>
      <input
        id={fid('name')}
        name="name"
        required
        maxLength={NAME_MAX}
        autoComplete="off"
        placeholder="e.g. Medical subscription (family)"
        defaultValue={valueOf(state, 'name', saved)}
        aria-describedby={fid('name-hint')}
        className="input"
      />
      <p id={fid('name-hint')} className="hint">
        The payslip names the deduction so.
      </p>
    </div>
  );
}

function AmountField({
  state,
  fid,
  saved,
  label = 'Amount a month (EGP)',
  onChange,
}: {
  state: FormState;
  fid: (n: string) => string;
  saved?: string;
  label?: string;
  onChange?: (typed: string) => void;
}) {
  return (
    <div>
      <label htmlFor={fid('amount')} className="label">
        {label}
      </label>
      <input
        id={fid('amount')}
        name="amount"
        required
        inputMode="decimal"
        autoComplete="off"
        placeholder="e.g. 350.00"
        defaultValue={valueOf(state, 'amount', saved)}
        onChange={onChange && ((e) => onChange(e.target.value))}
        className="input tabular-nums"
      />
    </div>
  );
}

/** Adds a recurring deduction; the fields are emptied once it is added, for the next one. */
export function AddRecurringForm({
  action,
  people,
  starts,
  ends,
  thisMonth,
}: {
  action: Action;
  people: (PersonRef & { department: string | null })[];
  starts: MonthChoice[];
  ends: MonthChoice[];
  thisMonth: string;
}) {
  const { state, pending, form } = useKeptForm(action);
  const ref = useRef<HTMLFormElement>(null);
  const fid = useFieldIds();
  // what is typed, for the figures under the fields (owner, 18 October 2026: "view assumed numbers")
  const [employeeId, setEmployeeId] = useState(valueOf(state, 'employeeId', ''));
  const [amount, setAmount] = useState(valueOf(state, 'amount', ''));
  const [start, setStart] = useState(valueOf(state, 'startMonth', thisMonth));
  const [end, setEnd] = useState(valueOf(state, 'endMonth', ''));
  // each employee's current gross, read once when they are chosen (null: not to be had)
  const [limits, setLimits] = useState<Record<string, AdvanceLimitView | null>>({});
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state.message) {
      setEmployeeId('');
      setAmount('');
      setStart(thisMonth);
      setEnd('');
    }
  }
  useEffect(() => {
    if (state.message) ref.current?.reset();
  }, [state]);

  function choose(id: string) {
    setEmployeeId(id);
    if (!id || id in limits) return;
    fetch(limitHref(id), { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<AdvanceLimitView>) : null))
      .catch(() => null)
      .then((view) => setLimits((known) => ({ ...known, [id]: view })));
  }
  const preview = recurringPreview(amount, start, end, employeeId ? limits[employeeId] : undefined);

  return (
    <form {...form} ref={ref} aria-label="Add a recurring deduction" className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('employeeId')} className="label">
            Employee
          </label>
          <Select id={fid('employeeId')} name="employeeId" required defaultValue={valueOf(state, 'employeeId', '')} onChange={(e) => choose(e.target.value)} className="input">
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.employeeCode}
                {p.department ? ` · ${p.department}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <NameField state={state} fid={fid} />
        <AmountField state={state} fid={fid} onChange={setAmount} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('startMonth')} className="label">
              First month
            </label>
            <MonthSelect id={fid('startMonth')} name="startMonth" required months={starts} value={valueOf(state, 'startMonth', thisMonth)} onChange={setStart} />
          </div>
          <div>
            <label htmlFor={fid('endMonth')} className="label">
              Last month <span className="font-normal text-muted">(optional)</span>
            </label>
            <MonthSelect id={fid('endMonth')} name="endMonth" months={ends} value={valueOf(state, 'endMonth', '')} emptyLabel="Until stopped" onChange={setEnd} />
          </div>
        </div>
      </div>
      {preview && (
        <div aria-live="polite" className={`space-y-1 rounded-lg border bg-card p-3 text-sm ${preview.overGross ? 'border-danger' : 'border-line'}`}>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">What It Comes To</p>
          <p className="font-semibold tabular-nums">{preview.period}</p>
          {preview.share && <p className={`tabular-nums ${preview.overGross ? 'text-danger' : 'text-muted'}`}>{preview.share}</p>}
        </div>
      )}
      <p className="hint">
        Each month&apos;s payroll run takes it as a deduction after tax, from its first month to its last, or until it is stopped; it stops by itself
        from the month after someone&apos;s last working day.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending} pendingText="Adding…">
          Add
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

/**
 * One running or to come, for HR: Change amount from a month (it stops there and one with the new amount starts), Stop
 * from a month (why, optional), Edit its name or last month.
 */
export function RecurringActions({
  change,
  stop,
  edit,
  saved,
  froms,
  ends,
  name,
}: {
  change: Action;
  stop: Action;
  edit: Action;
  saved: { name: string; amount: number; endMonth: string | null };
  /** The months a change or a stop can be from, the first to start with. */
  froms: MonthChoice[];
  ends: MonthChoice[];
  /** "the Medical subscription (family) of Nour Ali", for screen readers. */
  name: string;
}) {
  const first = froms[0]?.value ?? '';
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      {froms.length > 0 && (
        <>
          <InlineForm label="Change amount" name={name} action={change} submit="Change">
            {(state, fid) => (
              <>
                <AmountField state={state} fid={fid} saved={saved.amount.toFixed(2)} label="New amount a month (EGP)" />
                <div>
                  <label htmlFor={fid('fromMonth')} className="label">
                    From
                  </label>
                  <MonthSelect id={fid('fromMonth')} name="fromMonth" required months={froms} value={valueOf(state, 'fromMonth', first)} />
                  <p className="hint">The months before keep the amount they had.</p>
                </div>
              </>
            )}
          </InlineForm>
          <InlineForm label="Stop" name={name} action={stop} submit="Stop">
            {(state, fid) => (
              <>
                <div>
                  <label htmlFor={fid('fromMonth')} className="label">
                    No longer deducted from
                  </label>
                  <MonthSelect id={fid('fromMonth')} name="fromMonth" required months={froms} value={valueOf(state, 'fromMonth', first)} />
                </div>
                <Note state={state} fid={fid} label="Why it is stopped" />
              </>
            )}
          </InlineForm>
        </>
      )}
      <InlineForm label="Edit" name={name} action={edit} submit="Save">
        {(state, fid) => (
          <>
            <NameField state={state} fid={fid} saved={saved.name} />
            <div>
              <label htmlFor={fid('endMonth')} className="label">
                Last month <span className="font-normal text-muted">(optional)</span>
              </label>
              <MonthSelect id={fid('endMonth')} name="endMonth" months={ends} value={valueOf(state, 'endMonth', saved.endMonth ?? '')} emptyLabel="Until stopped" />
            </div>
          </>
        )}
      </InlineForm>
    </div>
  );
}
