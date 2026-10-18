'use client';

import { useEffect, useRef, useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import type { AdvanceLimitView, FormState } from '@/lib/types';
import { parseAmount } from '../../employees/[id]/contracts/salary';
import type { PersonRef } from '../adjustments/adjustments';
import { limitHref } from '../unsettled/installments';
import { InlineForm, Note } from '../unsettled/unsettled-forms';
import { CONSENT_FILE_MAX_MB, lastMonth, NAME_MAX, raisesAmount, recurringPreview, type RecurringPreview } from './recurring';

// Recurring Deductions' forms (owner, 18 October 2026: a medical subscription is an ongoing monthly share), for HR: a
// new one for an employee (what for, the amount a month, the first month and, if it has one, the last); on each one
// running or to come, Change amount from a month, Stop from a month, and Edit its name or last month. Each opens in its
// place from a small button and closes once saved; a refused one stays open with the API's reason. The Labour Law
// (owner, 18 October 2026, after reading the law: "Warn above 25%, record the consent"; Law 14/2025 Art. 114): adding
// one needs the tick that the employee's signed consent is on file, and the signed consent may be attached (kept in the
// employee file); a higher amount needs the tick again; one added before has its consent recorded (or its signed
// consent attached) from its row. What It Comes To shows, as it is typed, what the law counts the 25% against (the
// gross less about its tax and insurance and the month's installments) and warns of each month past it: a warning
// only, it can still be saved.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type MonthChoice = { value: string; label: string };

/** The photos and PDFs the employee file takes. */
const CONSENT_TYPES = 'image/jpeg,image/png,image/webp,application/pdf';

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

/**
 * The tick that the employee's signed consent is on file (Labour Law Art. 114): `required` to add one, or for a higher
 * amount (`label` says so).
 */
function ConsentTick({ state, fid, label = 'The employee’s signed consent is on file' }: { state: FormState; fid: (n: string) => string; label?: string }) {
  return (
    <div>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          name="consentOnFile"
          value="yes"
          required
          defaultChecked={valueOf(state, 'consentOnFile') === 'yes'}
          aria-describedby={fid('consentOnFile-hint')}
          className="size-5 accent-accent"
        />
        {label}
      </label>
      <p id={fid('consentOnFile-hint')} className="hint">
        A deduction from the pay the employee agrees to needs their written consent (Labour Law Art. 114). Kept with who ticked it and when.
      </p>
    </div>
  );
}

/** The signed consent, a photo or a PDF, kept in the employee file; `required` when attaching is all the form does. */
function ConsentFile({ fid, required = false }: { fid: (n: string) => string; required?: boolean }) {
  return (
    <div>
      <label htmlFor={fid('consentFile')} className="label">
        Signed consent {!required && <span className="font-normal text-muted">(optional)</span>}
      </label>
      <input
        id={fid('consentFile')}
        name="consentFile"
        type="file"
        accept={CONSENT_TYPES}
        required={required}
        aria-describedby={fid('consentFile-hint')}
        className="input py-2"
      />
      <p id={fid('consentFile-hint')} className="hint">
        A photo or a PDF of up to {CONSENT_FILE_MAX_MB} MB, kept in the employee file.
      </p>
    </div>
  );
}

/** What It Comes To: the months and what in all, what the law counts the 25% against, and each month past it. */
function WhatItComesTo({ preview }: { preview: RecurringPreview | null }) {
  if (!preview) return null;
  const over = preview.warnings.length > 0;
  return (
    <div aria-live="polite" className={`space-y-1 rounded-lg border bg-card p-3 text-sm ${over ? 'border-warn' : 'border-line'}`}>
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">What It Comes To</p>
      <p className="font-semibold tabular-nums">{preview.period}</p>
      {preview.share && <p className="text-muted tabular-nums">{preview.share}</p>}
      {over && (
        <div className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-warn">
          <ul className="space-y-1 tabular-nums">
            {preview.warnings.slice(0, 3).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {preview.warnings.length > 3 && (
            <p className="mt-1">
              And {preview.warnings.length - 3} more {preview.warnings.length - 3 === 1 ? 'month' : 'months'}.
            </p>
          )}
          <p className="mt-1 text-xs">A warning only: it can still be saved.</p>
        </div>
      )}
    </div>
  );
}

/** The figures the law's 25% is worked out with for an employee, read once each (undefined: not chosen or not read yet; null: not to be had). */
function useLimits() {
  const [limits, setLimits] = useState<Record<string, AdvanceLimitView | null>>({});
  const asked = useRef(new Set<string>());
  function read(id: string) {
    if (!id || asked.current.has(id)) return;
    asked.current.add(id);
    fetch(limitHref(id), { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<AdvanceLimitView>) : null))
      .catch(() => null)
      .then((view) => setLimits((known) => ({ ...known, [id]: view })));
  }
  return { limits, read };
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
  // each employee's pay, installments and other recurring deductions, read once when they are chosen
  const { limits, read } = useLimits();
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
    read(id);
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
      <WhatItComesTo preview={preview} />
      <div className="space-y-3 rounded-lg border border-line bg-card p-3">
        <ConsentTick state={state} fid={fid} />
        <ConsentFile fid={fid} />
      </div>
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
 * Change amount's fields: the new amount and the month it starts, What It Comes To for them (the one changed left out
 * from then, as it stops), and the consent tick once the amount is more than it has.
 */
function ChangeFields({
  state,
  fid,
  saved,
  froms,
  employeeId,
  recurringId,
}: {
  state: FormState;
  fid: (n: string) => string;
  saved: { amount: number; endMonth: string | null; stoppedFrom: string | null };
  froms: MonthChoice[];
  employeeId: string;
  recurringId: string;
}) {
  const [amount, setAmount] = useState(valueOf(state, 'amount', saved.amount.toFixed(2)));
  const [from, setFrom] = useState(valueOf(state, 'fromMonth', froms[0]?.value ?? ''));
  const { limits, read } = useLimits();
  useEffect(() => {
    read(employeeId);
  });
  const typed = parseAmount(amount);
  const raised = typed !== null && raisesAmount(typed, saved.amount);
  const preview = recurringPreview(amount, from, lastMonth(saved) ?? '', limits[employeeId], { replacing: recurringId });
  return (
    <>
      <AmountField state={state} fid={fid} saved={saved.amount.toFixed(2)} label="New amount a month (EGP)" onChange={setAmount} />
      <div>
        <label htmlFor={fid('fromMonth')} className="label">
          From
        </label>
        <MonthSelect id={fid('fromMonth')} name="fromMonth" required months={froms} value={valueOf(state, 'fromMonth', froms[0]?.value ?? '')} onChange={setFrom} />
        <p className="hint">The months before keep the amount they had.</p>
      </div>
      <WhatItComesTo preview={preview} />
      {raised && <ConsentTick state={state} fid={fid} label="The employee’s signed consent to the new amount is on file" />}
    </>
  );
}

/**
 * One running or to come, for HR: Change amount from a month (it stops there and one with the new amount starts), Stop
 * from a month (why, optional), Edit its name or last month; and its consent (Labour Law Art. 114): Record consent for
 * one added before it was asked, Attach signed consent for one recorded without it.
 */
export function RecurringActions({
  change,
  stop,
  edit,
  consent,
  saved,
  froms,
  ends,
  name,
  employeeId,
  recurringId,
}: {
  change: Action;
  stop: Action;
  edit: Action;
  /** Records the consent, or attaches the signed consent. */
  consent: Action;
  saved: {
    name: string;
    amount: number;
    endMonth: string | null;
    stoppedFrom: string | null;
    /** Its consent: none recorded (null), recorded (with or without the signed consent), or unknown (an API from before it). */
    consent: { recorded: boolean; attached: boolean } | undefined;
  };
  /** The months a change or a stop can be from, the first to start with. */
  froms: MonthChoice[];
  ends: MonthChoice[];
  /** "the Medical subscription (family) of Nour Ali", for screen readers. */
  name: string;
  employeeId: string;
  recurringId: string;
}) {
  const first = froms[0]?.value ?? '';
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      {saved.consent && !saved.consent.recorded && (
        <InlineForm label="Record consent" name={name} action={consent} submit="Record consent" pendingText="Recording…">
          {(state, fid) => (
            <>
              <input type="hidden" name="recorded" value="no" />
              <ConsentTick state={state} fid={fid} />
              <ConsentFile fid={fid} />
            </>
          )}
        </InlineForm>
      )}
      {saved.consent?.recorded && !saved.consent.attached && (
        <InlineForm label="Attach signed consent" name={name} action={consent} submit="Attach" pendingText="Attaching…">
          {(_state, fid) => (
            <>
              <input type="hidden" name="recorded" value="yes" />
              <ConsentFile fid={fid} required />
            </>
          )}
        </InlineForm>
      )}
      {froms.length > 0 && (
        <>
          <InlineForm label="Change amount" name={name} action={change} submit="Change">
            {(state, fid) => <ChangeFields state={state} fid={fid} saved={saved} froms={froms} employeeId={employeeId} recurringId={recurringId} />}
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
