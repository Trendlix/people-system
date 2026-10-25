'use client';

import { useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { DepartmentOrTeamOptions } from '@/components/department-options';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import type { Department, FormState } from '@/lib/types';
import { ActionButton, focusFirstField, useClosesOnSave } from '../../employees/[id]/contracts/contract-buttons';
import { amountField, deleteAssignmentConfirm, deleteTierConfirm, endAccountConfirm, tierDefault } from './accounts';
import type { AssignmentView, ClientAccountView, PersonOption, TierView } from './types';

// The Client Accounts page's forms (owner, 25 October 2026: "if an employee has an allowance per account, how can we
// deal with it?"): an account added or changed (its size fills in its default amount, which HR can change), ended on a
// day; a person assigned (the account's default filled in, changed when theirs differs), an assignment changed, ended
// or, by a Super Admin, deleted; and the sizes. Each opens in place and closes once saved; a refusal stays open with the
// API's reason. The API checks everything again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';

/** A form's footer: Save (or what it does) and Close, and what saving said. */
function Footer({ pending, label, pendingText, onClose }: { pending: boolean; label: string; pendingText?: string; onClose: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <SubmitButton busy={pending} pendingText={pendingText}>
        {label}
      </SubmitButton>
      <button type="button" onClick={onClose} className="btn btn-secondary">
        Close
      </button>
    </div>
  );
}

/** A "Saved." beside the button that opened a form. */
function Said({ state }: { state: FormState }) {
  return state.message ? (
    <p role="status" className="text-sm text-ok">
      {state.message}
    </p>
  ) : null;
}

/** An amount field in EGP a month. */
function AmountField({
  id,
  name,
  label,
  value,
  onChange,
  required,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        required={required}
        inputMode="decimal"
        autoComplete="off"
        placeholder="e.g. 1500.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="input tabular-nums"
      />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
}

// ---------- accounts ----------

/** The account's fields: names, code, size (filling in the default), default amount, team and notes. */
function AccountFields({
  state,
  account,
  tiers,
  departments,
}: {
  state: FormState;
  account: ClientAccountView | null;
  tiers: readonly TierView[];
  departments: Department[];
}) {
  const fid = useFieldIds();
  const [tierId, setTierId] = useState(valueOf(state, 'tierId', account?.tier?.id ?? ''));
  const [amount, setAmount] = useState(valueOf(state, 'defaultAmount', amountField(account?.defaultAmount)));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={fid('nameEn')} className="label">
          Name
        </label>
        <input
          id={fid('nameEn')}
          name="nameEn"
          required
          maxLength={150}
          autoComplete="off"
          defaultValue={valueOf(state, 'nameEn', account?.nameEn)}
          className="input"
        />
      </div>
      <div>
        <label htmlFor={fid('nameAr')} className="label">
          Name in Arabic <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={fid('nameAr')}
          name="nameAr"
          maxLength={150}
          dir="rtl"
          lang="ar"
          autoComplete="off"
          defaultValue={valueOf(state, 'nameAr', account?.nameAr)}
          className="input"
        />
      </div>
      <div>
        <label htmlFor={fid('code')} className="label">
          Code <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={fid('code')}
          name="code"
          maxLength={30}
          autoComplete="off"
          placeholder="e.g. ACME-01"
          defaultValue={valueOf(state, 'code', account?.code)}
          className="input"
        />
      </div>
      <div>
        <label htmlFor={fid('tierId')} className="label">
          Size <span className="font-normal text-muted">(optional)</span>
        </label>
        <Select
          id={fid('tierId')}
          name="tierId"
          value={tierId}
          onChange={(e) => {
            setTierId(e.target.value);
            // a size fills in its default amount; HR can change it after
            const filled = tierDefault(tiers, e.target.value);
            if (filled) setAmount(filled);
          }}
          className="input"
        >
          <option value="">No size</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nameEn}
            </option>
          ))}
        </Select>
      </div>
      <AmountField
        id={fid('defaultAmount')}
        name="defaultAmount"
        label="Default amount (EGP a month)"
        value={amount}
        onChange={setAmount}
        required={!!account || !tierId}
        hint={
          account
            ? 'Filled in for the next people assigned: those on it keep their own amounts.'
            : 'Filled in for each person assigned; change it for one whose amount differs.'
        }
      />
      <div>
        <label htmlFor={fid('departmentId')} className="label">
          Department or team that serves it <span className="font-normal text-muted">(optional)</span>
        </label>
        <Select id={fid('departmentId')} name="departmentId" defaultValue={valueOf(state, 'departmentId', account?.department?.id ?? '')} className="input">
          <option value="">None</option>
          <DepartmentOrTeamOptions departments={departments} />
        </Select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={fid('notes')} className="label">
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={fid('notes')} name="notes" maxLength={500} rows={2} defaultValue={valueOf(state, 'notes', account?.notes)} className="input" />
      </div>
    </div>
  );
}

/** Add account: its form opens below the button, emptied once added for the next one. */
export function AddAccount({ action, tiers, departments }: { action: Action; tiers: readonly TierView[]; departments: Department[] }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="btn btn-primary">
          Add account
        </button>
        <Said state={state} />
      </div>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label="Add a client account" className="space-y-4 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <AccountFields state={state} account={null} tiers={tiers} departments={departments} />
      <Footer pending={pending} label="Add account" pendingText="Adding…" onClose={() => setOpen(false)} />
    </form>
  );
}

/** Edit and End on an account: each opens its form in place. */
export function AccountActions({
  account,
  update,
  end,
  tiers,
  departments,
  today,
}: {
  account: ClientAccountView;
  update: Action;
  end: Action;
  tiers: readonly TierView[];
  departments: Department[];
  today: string;
}) {
  const edit = useKeptForm(update);
  const ending = useKeptForm(end);
  const [editing, setEditing] = useClosesOnSave(edit.state);
  const [closing, setClosing] = useClosesOnSave(ending.state);
  const fid = useFieldIds();
  if (editing) {
    return (
      <form {...edit.form} ref={focusFirstField} aria-label={`Edit ${account.nameEn}`} className="space-y-4 rounded-lg border border-line bg-canvas p-4">
        <FormErrors errors={edit.state.errors} />
        <AccountFields state={edit.state} account={account} tiers={tiers} departments={departments} />
        <Footer pending={edit.pending} label="Save" onClose={() => setEditing(false)} />
      </form>
    );
  }
  if (closing) {
    return (
      <form
        {...ending.form}
        onSubmit={(e) => {
          if (!window.confirm(endAccountConfirm(account.nameEn))) e.preventDefault();
          else ending.form.onSubmit(e);
        }}
        ref={focusFirstField}
        aria-label={`End ${account.nameEn}`}
        className="space-y-3 rounded-lg border border-line bg-canvas p-4"
      >
        <FormErrors errors={ending.state.errors} />
        <div className="max-w-xs">
          <label htmlFor={fid('endedOn')} className="label">
            Ends on
          </label>
          <DateInput
            id={fid('endedOn')}
            name="endedOn"
            required
            defaultValue={valueOf(ending.state, 'endedOn', formatDate(today))}
            aria-describedby={fid('endedOn-hint')}
          />
          <p id={fid('endedOn-hint')} className="hint">
            Its people&apos;s open assignments end that day.
          </p>
        </div>
        <Footer pending={ending.pending} label="End account" pendingText="Ending…" onClose={() => setClosing(false)} />
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Said state={edit.state.message ? edit.state : ending.state} />
      <button type="button" aria-expanded={false} onClick={() => setEditing(true)} className={`${small} btn-secondary`}>
        Edit<span className="sr-only"> {account.nameEn}</span>
      </button>
      {account.status === 'active' && (
        <button type="button" aria-expanded={false} onClick={() => setClosing(true)} className={`${small} btn-secondary`}>
          End<span className="sr-only"> {account.nameEn}</span>
        </button>
      )}
    </div>
  );
}

// ---------- assignments ----------

/** Assign a person: their employment's current one is used; the account's default amount filled in. */
export function AssignPerson({
  action,
  account,
  options,
  seesAmounts,
}: {
  action: Action;
  account: ClientAccountView;
  options: readonly PersonOption[];
  seesAmounts: boolean;
}) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const [amount, setAmount] = useState(valueOf(state, 'amount', amountField(account.defaultAmount)));
  const fid = useFieldIds();
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-expanded={false}
          onClick={() => {
            setAmount(amountField(account.defaultAmount));
            setOpen(true);
          }}
          className={`${small} btn-secondary`}
        >
          Assign a person<span className="sr-only"> to {account.nameEn}</span>
        </button>
        <Said state={state} />
      </div>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label={`Assign a person to ${account.nameEn}`} className="space-y-4 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={fid('employeeId')} className="label">
            Person
          </label>
          <Select
            id={fid('employeeId')}
            name="employeeId"
            required
            defaultValue={valueOf(state, 'employeeId', '')}
            aria-describedby={fid('employeeId-hint')}
            className="input"
          >
            <option value="">{options.length ? 'Choose…' : 'No one else to choose'}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <p id={fid('employeeId-hint')} className="hint">
            Someone with a current employment whose contract has the per-account allowance (the accounts allowance).
          </p>
        </div>
        <div>
          <label htmlFor={fid('fromDate')} className="label">
            From
          </label>
          <DateInput id={fid('fromDate')} name="fromDate" required defaultValue={valueOf(state, 'fromDate', '')} />
        </div>
        <div>
          <label htmlFor={fid('toDate')} className="label">
            To <span className="font-normal text-muted">(optional)</span>
          </label>
          <DateInput id={fid('toDate')} name="toDate" defaultValue={valueOf(state, 'toDate', '')} aria-describedby={fid('toDate-hint')} />
          <p id={fid('toDate-hint')} className="hint">
            Empty: still on it.
          </p>
        </div>
        {seesAmounts && (
          <AmountField
            id={fid('amount')}
            name="amount"
            label="Amount (EGP a month)"
            value={amount}
            onChange={setAmount}
            required={false}
            hint="The account’s default, filled in: change it when this person’s differs."
          />
        )}
        <div className={seesAmounts ? undefined : 'sm:col-span-2'}>
          <label htmlFor={fid('note')} className="label">
            Note <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('note')} name="note" maxLength={500} autoComplete="off" defaultValue={valueOf(state, 'note', '')} className="input" />
        </div>
      </div>
      <Footer pending={pending} label="Assign" pendingText="Assigning…" onClose={() => setOpen(false)} />
    </form>
  );
}

/** Edit, End and (a Super Admin's) Delete on an assignment. */
export function AssignmentActions({
  assignment,
  account,
  update,
  end,
  remove,
  seesAmounts,
  today,
}: {
  assignment: AssignmentView;
  account: string;
  update: Action;
  end: Action;
  /** A Super Admin's only. */
  remove: ((prev: FormState) => Promise<FormState>) | null;
  seesAmounts: boolean;
  today: string;
}) {
  const edit = useKeptForm(update);
  const ending = useKeptForm(end);
  const [editing, setEditing] = useClosesOnSave(edit.state);
  const [closing, setClosing] = useClosesOnSave(ending.state);
  const [amount, setAmount] = useState(valueOf(edit.state, 'amount', amountField(assignment.amount)));
  const fid = useFieldIds();
  const who = assignment.employee.fullNameEn;
  // still held, or held to a day to come: it can be ended
  const endable = assignment.toDate === null || assignment.toDate > today;

  if (editing) {
    return (
      <form {...edit.form} ref={focusFirstField} aria-label={`Edit ${who}'s assignment`} className="space-y-3 text-left">
        <FormErrors errors={edit.state.errors} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('fromDate')} className="label">
              From
            </label>
            <DateInput id={fid('fromDate')} name="fromDate" required defaultValue={valueOf(edit.state, 'fromDate', formatDate(assignment.fromDate))} />
          </div>
          <div>
            <label htmlFor={fid('toDate')} className="label">
              To <span className="font-normal text-muted">(optional)</span>
            </label>
            <DateInput
              id={fid('toDate')}
              name="toDate"
              defaultValue={valueOf(edit.state, 'toDate', formatDate(assignment.toDate))}
              aria-describedby={fid('toDate-hint')}
            />
            <p id={fid('toDate-hint')} className="hint">
              Empty: still on it.
            </p>
          </div>
          {seesAmounts && assignment.amount !== null && (
            <AmountField id={fid('amount')} name="amount" label="Amount (EGP a month)" value={amount} onChange={setAmount} required />
          )}
          <div>
            <label htmlFor={fid('note')} className="label">
              Note <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={fid('note')}
              name="note"
              maxLength={500}
              autoComplete="off"
              defaultValue={valueOf(edit.state, 'note', assignment.note)}
              className="input"
            />
          </div>
        </div>
        <Footer pending={edit.pending} label="Save" onClose={() => setEditing(false)} />
      </form>
    );
  }
  if (closing) {
    return (
      <form {...ending.form} ref={focusFirstField} aria-label={`End ${who}'s assignment`} className="space-y-3 text-left">
        <FormErrors errors={ending.state.errors} />
        <div className="max-w-xs">
          <label htmlFor={fid('end-toDate')} className="label">
            Last day on {account}
          </label>
          <DateInput id={fid('end-toDate')} name="toDate" required defaultValue={valueOf(ending.state, 'toDate', formatDate(today))} />
        </div>
        <Footer pending={ending.pending} label="End" pendingText="Ending…" onClose={() => setClosing(false)} />
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Said state={edit.state.message ? edit.state : ending.state} />
      <button
        type="button"
        aria-expanded={false}
        onClick={() => {
          setAmount(amountField(assignment.amount));
          setEditing(true);
        }}
        className={`${small} btn-secondary`}
      >
        Edit<span className="sr-only"> {who}&apos;s assignment</span>
      </button>
      {endable && (
        <button type="button" aria-expanded={false} onClick={() => setClosing(true)} className={`${small} btn-secondary`}>
          End<span className="sr-only"> {who}&apos;s assignment</span>
        </button>
      )}
      {remove && (
        <ActionButton action={remove} pendingText="Deleting…" variant="danger" confirmText={deleteAssignmentConfirm(who, account)}>
          Delete<span className="sr-only"> {who}&apos;s assignment</span>
        </ActionButton>
      )}
    </div>
  );
}

// ---------- sizes ----------

/** A size's name and default amount. */
function TierFields({ state, tier }: { state: FormState; tier: TierView | null }) {
  const fid = useFieldIds();
  const [amount, setAmount] = useState(valueOf(state, 'defaultAmount', amountField(tier?.defaultAmount)));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={fid('nameEn')} className="label">
          Name
        </label>
        <input
          id={fid('nameEn')}
          name="nameEn"
          required
          maxLength={50}
          autoComplete="off"
          placeholder="e.g. Small"
          defaultValue={valueOf(state, 'nameEn', tier?.nameEn)}
          className="input"
        />
      </div>
      <AmountField id={fid('defaultAmount')} name="defaultAmount" label="Default amount (EGP a month)" value={amount} onChange={setAmount} required />
    </div>
  );
}

/** Add size: its form opens below the button. */
export function AddTier({ action }: { action: Action }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
          Add size
        </button>
        <Said state={state} />
      </div>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label="Add a size" className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <TierFields state={state} tier={null} />
      <Footer pending={pending} label="Add size" pendingText="Adding…" onClose={() => setOpen(false)} />
    </form>
  );
}

/** Edit and (a Super Admin's) Delete on a size. */
export function TierActions({ tier, update, remove }: { tier: TierView; update: Action; remove: ((prev: FormState) => Promise<FormState>) | null }) {
  const { state, pending, form } = useKeptForm(update);
  const [open, setOpen] = useClosesOnSave(state);
  if (open) {
    return (
      <form {...form} ref={focusFirstField} aria-label={`Edit the size ${tier.nameEn}`} className="space-y-3 text-left">
        <FormErrors errors={state.errors} />
        <TierFields state={state} tier={tier} />
        <Footer pending={pending} label="Save" onClose={() => setOpen(false)} />
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Said state={state} />
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
        Edit<span className="sr-only"> the size {tier.nameEn}</span>
      </button>
      {remove && (
        <ActionButton action={remove} pendingText="Deleting…" variant="danger" confirmText={deleteTierConfirm(tier.nameEn)}>
          Delete<span className="sr-only"> the size {tier.nameEn}</span>
        </ActionButton>
      )}
    </div>
  );
}
