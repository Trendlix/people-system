'use client';

import { useState, useTransition } from 'react';
import { EXEMPTION_LABEL, EXEMPTION_REASON_MAX, type SuggestedExemptionStart } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { endExemptionConfirm, exemptButtonText, FROM_LOCK_HINT, fromField, ownStartText, periodText, reasonCount, startHint } from './exemptions';
import { withChosen } from './setup';

// The forms of people exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for
// attendance checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and
// "Profile + a list in Check-in Setup"): one reason (required), from a day and until a day (none: no end), for one person
// on their profile (its switch "Exempt from check-in") or for several chosen at once on Check-in Setup ("Add people", the
// searchable list with chips, as Link people chooses). "End now" asks first: a period started ends today, one not
// started is removed. The API checks the role and every value again.
// "From" (owner, 26 October 2026: "when exempting someone from attendance auto fill his contract start date in the
// exempt from date") starts as the person's contract's start, else their join date, else today, the hint under it
// saying which; on Check-in Setup it is filled in once one person is chosen, and with several each starts on their own
// (shown by their names) unless HR types a date for everyone. Left empty, each their own (ownStart).

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Someone the picker offers: their id, their name · code · team, and the first day theirs starts with (null: none sent). */
export interface ExemptionOption {
  value: string;
  label: string;
  from?: SuggestedExemptionStart | null;
}

/**
 * The reason and the days, for `employeeId` (the profile's) or for the people chosen from `options` (Check-in Setup's).
 * Once saved it closes (`onSaved`, with what to say).
 */
export function ExemptionForm({
  action,
  today,
  employeeId,
  name,
  suggested,
  options,
  onSaved,
  onCancel,
}: {
  action: Action;
  /** YYYY-MM-DD, Cairo: the first day without one of theirs. */
  today: string;
  /** One person (their profile), else chosen from `options`. */
  employeeId?: string;
  /** Their name, for the form's label. */
  name?: string;
  /** Their first day to start with (the profile's): their contract's start, else their join date; null: today. */
  suggested?: SuggestedExemptionStart | null;
  options?: readonly ExemptionOption[];
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const fid = useFieldIds();
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  // what HR typed in "From" (null until changed), and the field's key from then on: it is drawn again with the default
  // of whom is chosen only until HR changes it
  const [typed, setTyped] = useState<string | null>(null);
  const [typedKey, setTypedKey] = useState<string | null>(null);
  const { state, pending, form } = useKeptForm(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.message && !result.errors?.length) onSaved(result.message);
    return result;
  });
  const picking = !employeeId;
  const left = (options ?? []).filter((o) => !chosen.includes(o.value));
  const names = new Map((options ?? []).map((o) => [o.value, o.label]));
  const starts = new Map((options ?? []).map((o) => [o.value, o.from ?? null]));
  const from = picking ? fromField(chosen.map((id) => starts.get(id)), typed, today) : fromField([suggested], null, today);
  const autoKey = picking ? (chosen.length === 1 ? chosen[0] : chosen.length ? 'several' : 'none') : 'one';
  return (
    <form {...form} className="space-y-4 rounded-lg border border-line bg-canvas p-4" aria-label={picking ? 'Exempt people from check-in' : `Exempt ${name ?? 'them'} from check-in`}>
      <FormErrors errors={state.errors} />
      {employeeId ? (
        <input type="hidden" name="employeeId" value={employeeId} />
      ) : (
        <div className="space-y-2">
          <div>
            <label htmlFor={fid('person')} className="label">
              People
            </label>
            <Select
              id={fid('person')}
              autoFocus
              value=""
              onChange={(e) => setChosen((c) => withChosen(c, e.target.value))}
              aria-describedby={fid('person-hint')}
              className="input"
            >
              <option value="">{left.length ? 'Choose a person…' : 'No one else to choose'}</option>
              {left.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <p id={fid('person-hint')} className="hint">
              Type a name, a code or a team to search. Choose several: they get the same reason and last day, each from their own first day unless you type
              one. Someone exempt already isn&apos;t offered; their profile adds a later period.
            </p>
          </div>
          {chosen.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Chosen to exempt">
              {chosen.map((id) => {
                // each one's own first day, while "From" is empty
                const own = from.own ? ownStartText(starts.get(id)) : null;
                return (
                  <li key={id} className="inline-flex items-center gap-0.5 rounded-full border border-accent/40 bg-accent-soft py-0.5 ps-2.5 pe-0.5 text-xs font-medium text-accent">
                    {names.get(id) ?? id}
                    {own && (
                      <span className="font-normal tabular-nums" title={startHint(starts.get(id))}>
                        &nbsp;· {own}
                      </span>
                    )}
                    <input type="hidden" name="employeeId" value={id} />
                    <button
                      type="button"
                      onClick={() => setChosen((c) => c.filter((x) => x !== id))}
                      aria-label={`Take ${names.get(id) ?? 'this person'} off the list`}
                      className="inline-flex size-6 items-center justify-center rounded-full hover:bg-white"
                    >
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3">
                        <path d="M5 5l10 10M15 5L5 15" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div>
        <label htmlFor={fid('reason')} className="label">
          Reason
        </label>
        <textarea
          id={fid('reason')}
          name="reason"
          required
          rows={2}
          maxLength={EXEMPTION_REASON_MAX}
          defaultValue={valueOf(state, 'reason')}
          onChange={(e) => setReason(e.target.value)}
          aria-describedby={fid('reason-hint')}
          className="input"
          // the profile's form opens with the reason, the picker's with the people
          autoFocus={!picking}
        />
        <p id={fid('reason-hint')} className="hint flex justify-between gap-3">
          <span>Why they don&apos;t check in, e.g. works at the client&apos;s site all month.</span>
          <span className="tabular-nums">{reasonCount(reason || valueOf(state, 'reason'))}</span>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('startDate')} className="label">
            From
          </label>
          <DateInput
            key={`from-${typedKey ?? autoKey}`}
            id={fid('startDate')}
            name="startDate"
            // the picker's: whom is chosen until HR changes it (then the field keeps what they typed)
            defaultValue={picking ? from.value : valueOf(state, 'startDate', from.value)}
            onChange={
              picking
                ? (e) => {
                    setTypedKey((k) => k ?? autoKey);
                    setTyped(e.target.value);
                  }
                : undefined
            }
            aria-describedby={fid('from-hint')}
          />
          {/* empty: each from their own first day (their contract's start, else their join date) */}
          <input type="hidden" name="ownStart" value="1" />
          <p id={fid('from-hint')} className="hint">
            {from.hint} {FROM_LOCK_HINT}
          </p>
        </div>
        <div>
          <label htmlFor={fid('endDate')} className="label">
            Until <span className="font-normal text-muted">(optional)</span>
          </label>
          <DateInput id={fid('endDate')} name="endDate" defaultValue={valueOf(state, 'endDate')} aria-describedby={fid('until-hint')} />
          <p id={fid('until-hint')} className="hint">
            Its last day; empty for no end date, until HR ends it.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={pending} disabled={picking && !chosen.length} pendingText="Saving…">
          {picking ? (chosen.length ? exemptButtonText(chosen.length) : 'Exempt') : 'Exempt from check-in'}
        </SubmitButton>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Check-in Setup's "Add people": a button opening the form for several people. */
export function AddExemptions({ action, options, today }: { action: Action; options: readonly ExemptionOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (open) {
    return (
      <ExemptionForm
        action={action}
        today={today}
        options={options}
        onSaved={(message) => {
          setOpen(false);
          setDone(message);
        }}
        onCancel={() => setOpen(false)}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => {
          setDone(null);
          setOpen(true);
        }}
        disabled={options.length === 0}
        aria-expanded="false"
        className="btn btn-secondary min-h-9 px-3"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
          <path d="M10 4v12M4 10h12" />
        </svg>
        Add people
      </button>
      {options.length === 0 && <span className="text-xs text-muted">Everyone is exempt already.</span>}
      {done && (
        <p role="status" className="text-sm text-ok">
          {done}
        </p>
      )}
    </div>
  );
}

/** "End now" on a period: asked first (ends today, or removes one not started); says what happened. */
export function EndExemptionButton({
  end,
  name,
  period,
  today,
}: {
  end: () => Promise<FormState>;
  name: string;
  period: { startDate: string; endDate: string | null };
  today: string;
}) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<FormState>({});
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(endExemptionConfirm(name, period, today))) start(async () => setSaid(await end()));
        }}
        className="btn btn-secondary min-h-9 px-3"
      >
        {pending ? 'Ending…' : 'End now'}
        <span className="sr-only">: {name}’s exemption from check-in</span>
      </button>
      <div aria-live="polite" className="empty:hidden">
        {said.errors?.length ? <FormErrors errors={said.errors} /> : said.message ? <p className="text-sm text-ok">{said.message}</p> : null}
      </div>
    </div>
  );
}

/**
 * The profile's switch "Exempt from check-in": off, turning it on opens the form for them; on (a period current or to
 * come), turning it off ends that period now, asked first. With a period on that has an end, "Add a later period" opens
 * the form too.
 */
export function ExemptionSwitch({
  add,
  end,
  active,
  employeeId,
  name,
  suggested,
  today,
}: {
  add: Action;
  /** Ends `active` (bound to its id); null when nothing is on. */
  end: (() => Promise<FormState>) | null;
  active: { startDate: string; endDate: string | null } | null;
  employeeId: string;
  name: string;
  /** The first day a new period starts with: their contract's start, else their join date (null: today). */
  suggested: SuggestedExemptionStart | null;
  today: string;
}) {
  const fid = useFieldIds();
  const [formOpen, setFormOpen] = useState(false);
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<FormState>({});
  const on = active !== null || formOpen;
  return (
    <div className="space-y-3">
      <div>
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            checked={on}
            disabled={pending}
            onChange={(e) => {
              setSaid({});
              if (e.target.checked) setFormOpen(true);
              else if (formOpen && !active) setFormOpen(false);
              else if (active && end && window.confirm(endExemptionConfirm(name, active, today))) start(async () => setSaid(await end()));
            }}
            aria-describedby={fid('switch-hint')}
            className="size-5 accent-accent"
          />
          {EXEMPTION_LABEL}
        </label>
        <p id={fid('switch-hint')} className="hint max-w-3xl">
          {active
            ? `${periodText(active)}. Turning it off ends it now, asked first.`
            : 'On: their working days count as the shift’s full hours, whatever they press; checking in stays optional. Approved leave still counts as leave.'}
        </p>
      </div>
      {active?.endDate && !formOpen && (
        <button type="button" onClick={() => setFormOpen(true)} className="btn btn-secondary min-h-9 px-3">
          Add a later period
        </button>
      )}
      {formOpen && (
        <ExemptionForm
          action={add}
          today={today}
          employeeId={employeeId}
          name={name}
          suggested={suggested}
          onSaved={(message) => {
            setFormOpen(false);
            setSaid({ message });
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}
      <div aria-live="polite" className="empty:hidden">
        {said.errors?.length ? <FormErrors errors={said.errors} /> : said.message ? <p className="text-sm text-ok">{said.message}</p> : null}
      </div>
    </div>
  );
}
