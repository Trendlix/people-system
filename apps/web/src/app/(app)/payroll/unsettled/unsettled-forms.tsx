'use client';

import { useEffect, useRef, useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import type { AdvanceSettleWay } from '@trendlix/shared';
import type { AdvanceInstallment, AdvanceLimitView, FormState } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { ActionButton, focusFirstField, useClosesOnSave } from '../../employees/[id]/contracts/contract-buttons';
import { monthName, monthOf } from '../list';
import type { AdvanceRow, PersonRef } from '../adjustments/adjustments';
import { changePreview, firstMonthChoices, limitHref, limitText, planPreview, planProblem, postponeConfirm, SETTLE_CHOICES } from './installments';
import { clearanceOption, METHOD_CHOICES, type ClearanceDocument } from './unsettled';
import { joinShown } from '@/lib/hidden';

// Unsettled's forms (owner, 17 October 2026), for HR: a final settlement marked settled (the day, the amount paid, a
// note, the clearance document) or reopened; held pay recorded as paid out; an advance or loan recorded, changed or
// marked settled. Each opens in its place from a small button and closes once saved; a refused one stays open with the
// API's reason. Installments (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription
// or something that needs to be deducted as installments on the employee. how will it be managed?"): the record form
// takes how many months and the first month, showing each installment as it is typed, and, past the Labour Law's limit
// on a month's installments (owner, 18 October 2026, after reading the law: "Block above 10%"), why it can't be
// recorded, Record held back until it can; a pending installment is moved to the next month or changed; settling one
// asks how (paid back, deducted from the final settlement, or waived with a note why: leaving, "taken from the final
// settlement, unless waived").

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';

/**
 * A button that opens a small form in its place: `fields` are the form's, `label` the button's. Recurring Deductions'
 * forms open the same way (18 October 2026).
 */
export function InlineForm({
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

export function Note({ state, fid, label = 'Note', required = false }: { state: FormState; fid: (n: string) => string; label?: string; required?: boolean }) {
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

/** Marks a change made after the payroll moved on handled, once corrected by hand on a later payroll (27 October 2026): a note, optional. */
export function HandledForm({ action, name }: { action: Action; name: string }) {
  return (
    <InlineForm label="Mark handled" name={name} action={action} submit="Mark handled" pendingText="Marking…">
      {(state, fid) => <Note state={state} fid={fid} label="How it was corrected" />}
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

/** The settle form's choice of how, and the note it needs: why for a waiver, how for a payback. */
function SettleFields({ state, fid, outstanding }: { state: FormState; fid: (n: string) => string; outstanding: number }) {
  const [how, setHow] = useState<AdvanceSettleWay>((valueOf(state, 'how', 'paid_back') as AdvanceSettleWay) || 'paid_back');
  const hint = SETTLE_CHOICES.find((c) => c.value === how)?.hint;
  return (
    <>
      <fieldset>
        <legend className="label">
          How the <span className="tabular-nums">{formatEgp(outstanding)}</span> outstanding was settled
        </legend>
        <div className="space-y-1 text-sm">
          {SETTLE_CHOICES.map((c) => (
            <label key={c.value} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="how" value={c.value} required checked={how === c.value} onChange={() => setHow(c.value)} />
              {c.label}
            </label>
          ))}
        </div>
        {hint && <p className="hint">{hint} Its pending installments are cancelled.</p>}
      </fieldset>
      {how === 'waived' ? (
        <Note state={state} fid={fid} label="Why it is waived" required />
      ) : how === 'paid_back' ? (
        <Note state={state} fid={fid} label="How it was paid back" required />
      ) : (
        <Note state={state} fid={fid} />
      )}
    </>
  );
}

/**
 * Marks an advance or loan settled with something outstanding (owner, 18 October 2026): paid back, deducted from the
 * final settlement, or waived with a note why.
 */
export function SettleAdvanceForm({ action, name, outstanding }: { action: Action; name: string; outstanding: number }) {
  return (
    <InlineForm label="Mark settled" name={name} action={action} submit="Mark settled">
      {(state, fid) => <SettleFields state={state} fid={fid} outstanding={outstanding} />}
    </InlineForm>
  );
}

/**
 * What is outstanding on an advance or loan of someone who left (owner, 18 October 2026: "taken from the final
 * settlement, unless waived"): recorded as deducted from the final settlement, or waived with a note why.
 */
export function OutstandingActions({ deduct, waive, name }: { deduct: (prev: FormState) => Promise<FormState>; waive: Action; name: string }) {
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <ActionButton action={deduct} pendingText="Recording…" confirmText={`Record what is outstanding on ${name} as deducted from the final settlement? It is marked settled.`}>
        Deducted from the final settlement<span className="sr-only"> for {name}</span>
      </ActionButton>
      <InlineForm label="Waive" name={name} action={waive} submit="Waive">
        {(state, fid) => (
          <>
            <input type="hidden" name="how" value="waived" />
            <Note state={state} fid={fid} label="Why it is waived" required />
          </>
        )}
      </InlineForm>
    </div>
  );
}

/** The new amount of an installment, and what it does to the later ones as it is typed. */
function ChangeFields({ state, fid, installments, month }: { state: FormState; fid: (n: string) => string; installments: AdvanceInstallment[]; month: string }) {
  const current = installments.find((i) => i.month === month);
  const [amount, setAmount] = useState(valueOf(state, 'amount', current ? current.amount.toFixed(2) : ''));
  const preview = changePreview(installments, month, amount);
  return (
    <div>
      <input type="hidden" name="month" value={month} />
      <label htmlFor={fid('amount')} className="label">
        {monthName(month)} installment (EGP)
      </label>
      <input
        id={fid('amount')}
        name="amount"
        required
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-describedby={fid('amount-hint')}
        className="input tabular-nums"
      />
      <p id={fid('amount-hint')} aria-live="polite" className={`hint ${preview && 'problem' in preview ? 'text-danger' : ''}`}>
        {preview ? ('problem' in preview ? preview.problem : preview.text) : 'The later installments share what is left.'}
      </p>
    </div>
  );
}

/**
 * A pending installment HR may still change (owner, 18 October 2026): Move to next month (it and every later one move
 * a month on) or Change amount (the later ones share what is left).
 */
export function InstallmentActions({
  postpone,
  change,
  installments,
  month,
  name,
}: {
  postpone: (prev: FormState) => Promise<FormState>;
  change: Action;
  /** All the advance's installments: the change's preview works on the pending ones not locked. */
  installments: AdvanceInstallment[];
  month: string;
  /** "the November 2026 installment of the loan of Nour Ali", for screen readers. */
  name: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <ActionButton action={postpone} pendingText="Moving…" confirmText={postponeConfirm(month)}>
        Move to next month<span className="sr-only"> {name}</span>
      </ActionButton>
      <InlineForm label="Change amount" name={name} action={change} submit="Change">
        {(state, fid) => <ChangeFields state={state} fid={fid} installments={installments} month={month} />}
      </InlineForm>
    </div>
  );
}

/**
 * The amount, the day it was given, the reason and the plan: as both advance forms ask them. `plan: false`: no plan
 * field, as the installments make it (a new one recovered in installments); one with installments keeps its plan.
 */
function AdvanceFields({
  state,
  fid,
  advance,
  today,
  plan = true,
  onAmount,
}: {
  state: FormState;
  fid: (n: string) => string;
  advance: AdvanceRow | null;
  today: string;
  plan?: boolean;
  /** The amount as it is typed, for the installments' live plan. */
  onAmount?: (amount: string) => void;
}) {
  const madeByInstallments = (advance?.installments?.length ?? 0) > 0;
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
          onChange={onAmount && ((e) => onAmount(e.target.value))}
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
      {!plan ? null : madeByInstallments ? (
        // its plan is the installments' (18 October 2026): kept as it is
        <input type="hidden" name="plan" value={advance?.plan ?? ''} />
      ) : (
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
      )}
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

/**
 * The plan of a new one recovered in installments, worked out as it is typed (owner, 18 October 2026): each month's
 * installment, and why it can't be recorded when a month passes the law's limit (`problem`, planProblem).
 */
function PlanPreview({
  amount,
  count,
  firstMonth,
  limit,
  problem,
}: {
  amount: string;
  count: string;
  firstMonth: string;
  limit: AdvanceLimitView | null;
  problem: string | null;
}) {
  const preview = planPreview(amount, count, firstMonth);
  const about = limitText(limit);
  return (
    <div aria-live="polite" className="space-y-2 sm:col-span-2">
      {!preview ? (
        <p className="hint">Enter the amount and how many months to see each installment.</p>
      ) : !preview.ok ? (
        <p className="text-sm text-danger">{preview.problems.join(' ')}</p>
      ) : (
        <div className="text-sm">
          <p>
            <span className="font-semibold">{preview.text}</span>, {preview.months}
          </p>
          {preview.plan.length > 1 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted">Each month</summary>
              <ul className="mt-1 grid gap-x-6 text-xs sm:grid-cols-2">
                {preview.plan.map((p) => (
                  <li key={p.month} className="flex justify-between gap-4 border-b border-line-soft py-1">
                    <span>{monthName(p.month)}</span>
                    <span className="tabular-nums">{formatEgp(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {problem && (
        <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <p>{problem}</p>
          <p className="mt-1 text-xs">It can&apos;t be recorded so: the Labour Law allows at most 10% of the wage a month to repay an advance or a loan.</p>
        </div>
      )}
      {about && <p className="hint">{about}</p>}
    </div>
  );
}

/**
 * Records a new advance or loan; the fields are emptied once it is recorded, for the next one. Recover in installments
 * (owner, 18 October 2026), ticked to start with: how many months and the first, every installment made at once; the
 * employee's pay and installments already planned are read when they are chosen, for the warning.
 */
export function NewAdvanceForm({ action, people, today }: { action: Action; people: (PersonRef & { department: string | null })[]; today: string }) {
  const { state, pending, form } = useKeptForm(action);
  const ref = useRef<HTMLFormElement>(null);
  const fid = useFieldIds();
  const months = firstMonthChoices(today);
  const thisMonth = monthOf(today);
  const [employeeId, setEmployeeId] = useState(valueOf(state, 'employeeId', ''));
  const [amount, setAmount] = useState(valueOf(state, 'amount', ''));
  const [byInstallments, setByInstallments] = useState(valueOf(state, 'byInstallments', 'yes') === 'yes');
  const [count, setCount] = useState(valueOf(state, 'count', ''));
  const [firstMonth, setFirstMonth] = useState(valueOf(state, 'firstMonth', thisMonth));
  // each employee's pay and installments, read once when they are chosen (null: not to be had)
  const [limits, setLimits] = useState<Record<string, AdvanceLimitView | null>>({});
  // the fields start afresh after each one recorded, and the installments planned are read again
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state.message) {
      setEmployeeId('');
      setAmount('');
      setByInstallments(true);
      setCount('');
      setFirstMonth(thisMonth);
      setLimits({});
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
  // past the law's limit (owner, 18 October 2026: "Block above 10%"): said under the plan, and Record held back
  const limit = limits[employeeId] ?? null;
  const preview = byInstallments ? planPreview(amount, count, firstMonth) : null;
  const problem = preview?.ok ? planProblem(preview.plan, limit) : null;

  return (
    <form {...form} ref={ref} aria-label="Record an advance or loan" className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('employeeId')} className="label">
            Employee
          </label>
          <Select id={fid('employeeId')} name="employeeId" required value={employeeId} onChange={(e) => choose(e.target.value)} className="input">
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {joinShown([p.name, p.employeeCode, p.department])}
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
      <AdvanceFields state={state} fid={fid} advance={null} today={today} plan={!byInstallments} onAmount={setAmount} />
      <div className="space-y-3 rounded-lg border border-line bg-card p-3">
        <div>
          <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              name="byInstallments"
              value="yes"
              checked={byInstallments}
              onChange={(e) => setByInstallments(e.target.checked)}
              aria-describedby={fid('byInstallments-hint')}
              className="size-5 accent-accent"
            />
            Recover in installments
          </label>
          <p id={fid('byInstallments-hint')} className="hint">
            {byInstallments
              ? 'Every monthly installment is made now, each a deduction linked to it on its month’s payroll: equal amounts, the last taking the rounding. Each can be moved or changed later.'
              : 'No installments made: plan its recovery by hand on Additions / Deductions.'}
          </p>
        </div>
        {byInstallments && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('count')} className="label">
                Monthly installments
              </label>
              <input
                id={fid('count')}
                name="count"
                required
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 6"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor={fid('firstMonth')} className="label">
                First installment in
              </label>
              <Select id={fid('firstMonth')} name="firstMonth" required value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)} className="input">
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <PlanPreview amount={amount} count={count} firstMonth={firstMonth} limit={limit} problem={problem} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending} pendingText="Recording…" disabled={problem !== null}>
          Record
        </SubmitButton>
        {problem && <p className="text-sm text-muted">Spread it over more months, or start it later, to record it.</p>}
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
