'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  defaultEffectiveFrom,
  RAISE_DECISION_LABELS,
  RAISE_FIGURE_KIND_LABELS,
  RAISE_FIGURE_KINDS,
  RAISE_REASON_CHOICES,
  RAISE_REASON_LABELS,
  RAISE_WAY_HINTS,
  RAISE_WAY_LABELS,
  RAISE_WAYS,
  raiseEffectiveProblem,
  type AllowanceTerms,
  type LawRates,
  type RaiseDecision,
  type RaiseFigureKind,
  type RaiseRequester,
  type RaiseWay,
} from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { SurfaceField } from '@/components/surface';
import { formatDate, parseDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { choice } from '../employees/[id]/contracts/pay-fields';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { previewGross } from './decisions';
import { changeWords, typedRaiseFigures, yearOf, type Change, type PayBefore, type RaiseFigures } from './figures';
import { commentReaders, effectiveFromOptions, figuresNote } from './list';

// The small forms of raise requests (owner's decisions, 16 October 2026; reworked 17 October 2026: "requesting a raise
// should have a drop list reason first ( Annual Raise - Performance Raise - Counter Offer Raise - etc..) then add
// requester comment, suggest raise amount or percentage, then the approver to Approve - Approve with another raise amount
// or percentge - Reject, and add a comment"): the request form, on its own page under Requests → Raise Requests since 17
// October 2026 ("i think raising a request should be moved from the Employee tab to the raise requests tab"), for the
// employee themself, their direct manager and HR, with the month the raise is asked from ("Effective from"); HR's
// decision on a request (Approve as suggested, Approve with another raise, Reject), and Reject alone for a request whose
// raise is prepared, on the Raise Requests page. The raise typed (an amount or a percent) is the shared figure field, the
// CEO's decision on Approvals too, with what it comes to beside it for those sent the pay ("while raising a request show
// some figures regarding the raise (Gross and net) but mainly we are working on the gross salary"). HR's forms open in
// place; one that went through closes and says so, one refused stays open with the reason.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

/** Moves focus into the form when it opens (a stable function, so a later render doesn't move it again). */
const focusOnOpen = (el: HTMLElement | null) => el?.focus();

/** Whether the last answer went through: the form then closes (the page has refreshed with it). */
function useClosesOnSuccess(state: FormState, close: () => void) {
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state.message) close();
  }
}

function Done({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
      {message}
    </p>
  );
}

/** What the figures panel works the raise out from, and how it says who sees it. */
export interface FiguresFor {
  /** The pay before the raise: the pay in force (or, for the CEO, the version the raise replaces). */
  pay: PayBefore;
  /** The years' rates set by law, for the net. */
  rates: readonly LawRates[];
  /** The year the raise takes effect in, for the rates. */
  year: number;
  /** Who sees these figures, under them. */
  note: string;
  /** The allowances after the raise, when they change with it; else the same. */
  allowancesAfter?: readonly AllowanceTerms[] | null;
  /** By the hour, the raise's own hours a week, when they change with it. */
  hoursAfter?: number | null;
}

function ChangeRow({ label, c, prominent = false, suffix }: { label: string; c: Change; prominent?: boolean; suffix?: string }) {
  return (
    <div>
      <dt className={prominent ? 'text-sm font-medium' : 'text-xs text-muted'}>{label}</dt>
      <dd className={`tabular-nums ${prominent ? 'text-base font-semibold' : 'text-sm'}`}>
        {formatEgp(c.from)} → {formatEgp(c.to)}
        {suffix && <span className="font-normal text-muted"> {suffix}</span>}
        <span className={`block ${prominent ? 'text-sm text-ok' : 'text-xs text-muted'}`}>{changeWords(c, formatEgp)}</span>
      </dd>
    </div>
  );
}

/**
 * What the raise typed comes to (owner, 17 October 2026: "show some figures regarding the raise (Gross and net) but
 * mainly we are working on the gross salary"): the gross a month now, after it and the change, first and largest; by
 * the hour the rate, which the raise is on, with the monthly estimate; then the net a month, approximately, with the
 * allowances as they are. Live as the raise is typed; a line asking for it until it is a valid raise.
 */
export function FiguresPanel({ figures, note, id }: { figures: RaiseFigures | null; note: string; id?: string }) {
  return (
    <section id={id} aria-label="What the raise comes to" className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <h3 className="text-sm font-semibold">What the Raise Comes To</h3>
      <div role="status" aria-live="polite">
        {figures ? (
          <dl className="space-y-3">
            {figures.hourly && <ChangeRow label="Hourly rate" c={figures.hourly} prominent />}
            <ChangeRow label={figures.hourly ? 'Gross a month (estimate from the hours)' : 'Gross a month'} c={figures.gross} prominent={!figures.hourly} />
            <ChangeRow label="Net a month (approximate)" c={figures.net} />
            <p className="text-xs text-muted">
              {figures.allowances > 0
                ? `The net includes the allowances, ${formatEgp(figures.allowances)} a month, unchanged by the raise.`
                : 'No allowances: the net is from the gross alone.'}{' '}
              Worked out with the {figures.year} rates set by law.
            </p>
          </dl>
        ) : (
          <p className="text-sm text-muted">Type the raise, as an amount or a percent, to see the gross and the net it comes to.</p>
        )}
      </div>
      <p className="hint">{note}</p>
    </section>
  );
}

/**
 * A raise typed as an amount in EGP a month (added to the gross) or a percent of the gross, of the kinds the caller may
 * use (a manager: a percent only, with no switch), sent as figureKind and figureValue. With the gross in force (only
 * for those who see salaries), it says what the raise comes to; with the pay (`figures`: HR, Finance, the CEO, and the
 * employee for their own, 17 October 2026), the figures panel beside it, live as it is typed.
 */
export function FigureField({
  fid,
  state,
  kinds = RAISE_FIGURE_KINDS,
  gross = null,
  figures = null,
  wide = false,
  label,
  hint,
  required = false,
}: {
  fid: (name: string) => string;
  state: FormState;
  kinds?: readonly RaiseFigureKind[];
  /** The gross the raise is on, to show what it comes to; null: not shown. */
  gross?: number | null;
  /** The pay and rates for the figures panel; null: no panel. */
  figures?: FiguresFor | null;
  /** The panel beside the field on a wide screen, rather than under it. */
  wide?: boolean;
  label: string;
  hint?: string;
  required?: boolean;
}) {
  const [kind, setKind] = useState<RaiseFigureKind>(() => {
    const kept = valueOf(state, 'figureKind', kinds[0]);
    return (kinds as readonly string[]).includes(kept) ? (kept as RaiseFigureKind) : kinds[0];
  });
  const [value, setValue] = useState(() => valueOf(state, 'figureValue'));
  // the panel says it all when there is one; else the one line of the gross it comes to
  const preview = figures ? null : previewGross(gross, kind, value);
  const worked = figures ? typedRaiseFigures(figures.pay, kind, value, figures.rates, figures.year, figures) : null;
  const describedBy = `${fid('figureValue-hint')}${preview !== null ? ` ${fid('figureValue-preview')}` : ''}`;
  const field = (
    <fieldset className="space-y-2">
      <legend className="label">
        {label} {!required && optional}
      </legend>
      {kinds.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <label key={k} className={choice}>
              <input type="radio" name="figureKind" value={k} checked={kind === k} onChange={() => setKind(k)} className="size-4 accent-accent" />
              {RAISE_FIGURE_KIND_LABELS[k]}
            </label>
          ))}
        </div>
      ) : (
        <input type="hidden" name="figureKind" value={kind} />
      )}
      <div className="flex items-center gap-2">
        <label htmlFor={fid('figureValue')} className="sr-only">
          {kind === 'amount' ? 'Amount in EGP a month' : 'Percent of the gross'}
        </label>
        {kind === 'amount' && <span className="text-sm text-muted">EGP</span>}
        <input
          id={fid('figureValue')}
          name="figureValue"
          inputMode="decimal"
          autoComplete="off"
          required={required}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={describedBy}
          className="input max-w-40 tabular-nums"
        />
        {kind === 'percent' && <span className="text-sm text-muted">%</span>}
      </div>
      <p id={fid('figureValue-hint')} className="hint">
        {hint ?? (kind === 'amount' ? 'Added to the monthly gross, e.g. 1,500; the allowances stay as they are.' : 'Of the monthly gross, e.g. 10 or 7.5; the allowances stay as they are.')}
      </p>
      <div role="status">
        {preview !== null && (
          <p id={fid('figureValue-preview')} className="hint font-medium text-ink">
            Comes to a gross of <span className="tabular-nums">{formatEgp(preview)}</span> a month.
          </p>
        )}
      </div>
    </fieldset>
  );
  if (!figures) return field;
  return (
    <div className={wide ? 'grid gap-4 md:grid-cols-2 md:items-start' : 'space-y-4'}>
      {field}
      <FiguresPanel id={fid('figures')} figures={worked} note={figures.note} />
    </div>
  );
}

/** A required comment, saying who reads it. */
function CommentField({ fid, state, label, readers, rows = 3, maxLength = 1000 }: { fid: (name: string) => string; state: FormState; label: string; readers: string; rows?: number; maxLength?: number }) {
  return (
    <div>
      <label htmlFor={fid('comment')} className="label">
        {label}
      </label>
      <textarea
        id={fid('comment')}
        name="comment"
        rows={rows}
        required
        maxLength={maxLength}
        aria-describedby={fid('comment-hint')}
        defaultValue={valueOf(state, 'comment')}
        className="input"
      />
      <p id={fid('comment-hint')} className="hint">
        {readers}
      </p>
    </div>
  );
}

/**
 * Request a raise (its own page under Requests → Raise Requests, 17 October 2026): why, from the list (first), the
 * month it is asked from ("Effective from": this month or a later one, next month unless another is chosen), the
 * comment, and the raise suggested: an amount or a percent for the employee and HR (`suggestsAmount`), a percent only
 * for a manager, who doesn't see salaries. `suggestionKinds`, when the API sends them, say the same; `currentGross`
 * (HR only) shows what a suggestion comes to; `pay` (HR, Finance, the CEO, and the employee for their own) the figures
 * panel beside it. Open from the start; Cancel goes back (`cancelHref`); once sent, the action opens where it is listed.
 */
export function RequestRaiseForm({
  action,
  suggestsAmount,
  forSelf,
  name,
  suggestionKinds,
  currentGross = null,
  pay = null,
  rates = [],
  today,
  cancelHref,
}: {
  action: Action;
  suggestsAmount: boolean;
  forSelf: boolean;
  name: string;
  suggestionKinds?: readonly RaiseFigureKind[];
  currentGross?: number | null;
  /** The pay in force for the figures panel; null: none (a manager, or no signed contract yet). */
  pay?: PayBefore | null;
  /** The years' rates set by law, for the net. */
  rates?: readonly LawRates[];
  /** Today in Cairo (YYYY-MM-DD): the months offered start from this one. */
  today: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const months = effectiveFromOptions(today);
  const [effectiveFrom, setEffectiveFrom] = useState(() => {
    const kept = valueOf(state, 'effectiveFrom', defaultEffectiveFrom(today));
    return months.some((m) => m.value === kept) ? kept : defaultEffectiveFrom(today);
  });
  const kinds: readonly RaiseFigureKind[] = suggestionKinds?.length ? suggestionKinds : suggestsAmount ? RAISE_FIGURE_KINDS : ['percent'];
  const requester: RaiseRequester = forSelf ? 'self' : suggestsAmount ? 'hr' : 'manager';
  const year = yearOf(effectiveFrom, today);

  return (
    <form action={formAction} aria-label={forSelf ? 'Request a raise' : `Request a raise for ${name}`} className="card space-y-5 p-5">
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('raiseReason')} className="label">
            Reason
          </label>
          <Select
            id={fid('raiseReason')}
            name="raiseReason"
            required
            defaultValue={valueOf(state, 'raiseReason')}
            aria-describedby={fid('raiseReason-hint')}
            className="input"
          >
            <option value="">Choose a reason</option>
            {RAISE_REASON_CHOICES.map((r) => (
              <option key={r} value={r}>
                {RAISE_REASON_LABELS[r]}
              </option>
            ))}
          </Select>
          <p id={fid('raiseReason-hint')} className="hint">
            Why the raise is asked for. HR decides first, then the CEO.
          </p>
        </div>
        <div>
          <label htmlFor={fid('effectiveFrom')} className="label">
            Effective from
          </label>
          <Select
            id={fid('effectiveFrom')}
            name="effectiveFrom"
            required
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            aria-describedby={fid('effectiveFrom-hint')}
            className="input"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
          <p id={fid('effectiveFrom-hint')} className="hint">
            The month the raise is to take effect from, on its 1st. HR and the CEO may set another.
          </p>
        </div>
      </div>
      <CommentField
        fid={fid}
        state={state}
        label="Comment"
        rows={4}
        maxLength={2000}
        readers={`${forSelf ? 'What you have taken on or achieved, and since when.' : `What ${name} has taken on or achieved, and since when.`} ${commentReaders('request', requester, forSelf)}`}
      />
      <FigureField
        fid={fid}
        state={state}
        kinds={kinds}
        gross={currentGross}
        figures={pay ? { pay, rates, year, note: figuresNote(forSelf) } : null}
        wide
        label="Suggested raise"
        hint={
          kinds.length === 1
            ? "A percent of the monthly gross, e.g. 10: a direct manager doesn't see salaries, so HR and the CEO set the amount."
            : 'An amount in EGP added to the monthly gross, e.g. 1,500, or a percent of it, e.g. 10. HR and the CEO decide the raise.'
        }
      />
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending} pendingText="Sending…">
          Send request
        </SubmitButton>
        <Link href={cancelHref} className={`btn btn-secondary ${pending ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={pending || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

const SUBMIT: Record<RaiseDecision, { label: string; busy: string }> = {
  approve: { label: 'Approve and send to the CEO', busy: 'Approving…' },
  approve_other: { label: 'Approve and send to the CEO', busy: 'Approving…' },
  reject: { label: 'Reject the request', busy: 'Rejecting…' },
};

/**
 * HR's decision on a request with HR (owner, 17 October 2026): Approve as suggested (when it suggests a raise), Approve
 * with another raise (an amount or a percent of the gross in force), or Reject; always with a comment. Approving also
 * says how the raise is made, the way and the effective date (a new contract's length too): the raise is prepared from
 * it with the pay in force raised by the figure, and sent to the CEO. For a promotion or other allowances with it, the
 * whole raise form (`fullFormHref`). The date starts as the month the request is asked from (17 October 2026). Another
 * raise shows what it comes to beside it (`pay`, the pay in force; `rates` for the net).
 */
export function HrDecisionForm({
  action,
  name,
  requester,
  suggestion,
  gross,
  inForce,
  defaultEffective,
  fullFormHref,
  pay = null,
  rates = [],
}: {
  action: Action;
  name: string;
  requester: RaiseRequester;
  /** The raise suggested, in words; null when it suggests none (it is then approved with another raise only). */
  suggestion: string | null;
  /** The gross in force, for what another raise comes to. */
  gross: number | null;
  /** The contract in force: a raise takes effect after it started and not after it ends. */
  inForce: { startDate: string; endDate: string | null } | null;
  /** YYYY-MM-DD: the date it starts with, the request's Effective from (else the next 1st of a month it may take effect on). */
  defaultEffective: string;
  /** The whole raise form, HR's (the Contract section); null for the CEO taking HR's step on a C-level person's (19 October 2026). */
  fullFormHref: string | null;
  /** The pay in force, for the figures of another raise. */
  pay?: PayBefore | null;
  rates?: readonly LawRates[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<RaiseDecision | ''>(() => valueOf(state, 'decision') as RaiseDecision | '');
  const [way, setWay] = useState<RaiseWay>(() => (valueOf(state, 'way', 'amendment') === 'contract' ? 'contract' : 'amendment'));
  const [effective, setEffective] = useState(() => valueOf(state, 'effectiveDate', formatDate(defaultEffective)));
  const fid = useFieldIds();
  useClosesOnSuccess(state, () => setOpen(false));

  if (!open) {
    return (
      <div className="space-y-2">
        <Done message={state.message} />
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="btn btn-primary min-h-9 px-3">
          Decide<span className="sr-only"> on the raise request for {name}</span>
        </button>
      </div>
    );
  }

  const approving = decision === 'approve' || decision === 'approve_other';
  const date = parseDate(effective);
  const problem = !approving ? null : date === null ? 'Enter the date as DD/MM/YYYY, e.g. 01/12/2026.' : date && inForce ? raiseEffectiveProblem(date, inForce) : null;
  const choices: RaiseDecision[] = suggestion ? ['approve', 'approve_other', 'reject'] : ['approve_other', 'reject'];
  const submit = decision ? SUBMIT[decision] : null;

  return (
    <form
      action={formAction}
      onChange={(e) => {
        // the date typed, for the check under it (the field stays uncontrolled)
        if (e.target instanceof HTMLInputElement && e.target.name === 'effectiveDate') setEffective(e.target.value);
      }}
      onSubmit={(e) => {
        if (decision === 'reject' && !window.confirm(`Reject the raise request for ${name}? Your comment shows on it.`)) e.preventDefault();
      }}
      aria-label={`Decide on the raise request for ${name}`}
      className="w-full max-w-xl min-w-72 space-y-4 rounded-lg border border-line bg-canvas p-4 whitespace-normal"
    >
      <FormErrors errors={state.errors} />
      <fieldset>
        <legend className="label">Decision</legend>
        <div className="space-y-2">
          {choices.map((d, i) => (
            <label key={d} className={`${choice} w-full`}>
              <input
                ref={i === 0 ? focusOnOpen : undefined}
                type="radio"
                name="decision"
                value={d}
                checked={decision === d}
                onChange={() => setDecision(d)}
                className="size-4 accent-accent"
              />
              <span>
                {d === 'approve' ? 'Approve as suggested' : RAISE_DECISION_LABELS[d]}
                {d === 'approve' && suggestion && <span className="block text-xs text-muted tabular-nums">{suggestion}</span>}
              </span>
            </label>
          ))}
        </div>
        {!suggestion && <p className="hint">The request suggests no raise: approving it sets the raise.</p>}
      </fieldset>

      {decision === 'approve_other' && (
        <FigureField
          fid={fid}
          state={state}
          gross={gross}
          figures={pay ? { pay, rates, year: yearOf(date, defaultEffective), note: figuresNote(false) } : null}
          label="The raise"
          required
        />
      )}

      {approving && (
        <>
          <fieldset aria-describedby={fid('way-hint')}>
            <legend className="label">How the raise is made</legend>
            <div className="flex flex-wrap gap-2">
              {RAISE_WAYS.map((w) => (
                <label key={w} className={choice}>
                  <input type="radio" name="way" value={w} checked={way === w} onChange={() => setWay(w)} className="size-4 accent-accent" />
                  {RAISE_WAY_LABELS[w]}
                </label>
              ))}
            </div>
            <p id={fid('way-hint')} className="hint">
              {RAISE_WAY_HINTS[way]}
            </p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('effectiveDate')} className="label">
                Takes effect on
              </label>
              <DateInput
                id={fid('effectiveDate')}
                name="effectiveDate"
                required
                defaultValue={effective}
                aria-describedby={`${fid('effectiveDate-hint')}${problem ? ` ${fid('effectiveDate-problem')}` : ''}`}
              />
              <p id={fid('effectiveDate-hint')} className="hint">
                The 1st of a month, so each payroll month has one salary.
              </p>
              <div role="status">
                {problem && (
                  <p id={fid('effectiveDate-problem')} className="hint text-warn">
                    {problem}
                  </p>
                )}
              </div>
            </div>
            {way === 'contract' && (
              <div>
                <label htmlFor={fid('durationMonths')} className="label">
                  Length in months {optional}
                </label>
                <input
                  id={fid('durationMonths')}
                  name="durationMonths"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  step={1}
                  aria-describedby={fid('durationMonths-hint')}
                  defaultValue={valueOf(state, 'durationMonths')}
                  className="input tabular-nums"
                />
                <p id={fid('durationMonths-hint')} className="hint">
                  Empty: the usual length from the contract settings.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      <CommentField fid={fid} state={state} label="Comment" readers={commentReaders('decision', requester)} />

      {approving && (
        <p className="hint">
          The raise is prepared from the pay in force, the allowances as they are, and sent to the CEO.
          {fullFormHref && (
            <>
              {' '}
              <Link href={fullFormHref} prefetch={false}>
                Approve it in the whole raise form
              </Link>{' '}
              for a promotion or other allowances with it.
            </>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {decision === 'reject' ? (
          <button type="submit" disabled={pending} className="btn btn-danger">
            {pending ? SUBMIT.reject.busy : SUBMIT.reject.label}
          </button>
        ) : (
          <SubmitButton busy={pending} pendingText={submit?.busy ?? 'Saving…'}>
            {submit?.label ?? 'Save the decision'}
          </SubmitButton>
        )}
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * HR's Reject, for a request whose raise is prepared (returned by the CEO, or prepared before 17 October 2026): the
 * comment is required; asks first. The raise goes with it.
 */
export function DeclineRequestForm({ action, name, requester = 'self' }: { action: Action; name: string; requester?: RaiseRequester }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  const fid = useFieldIds();
  useClosesOnSuccess(state, () => setOpen(false));

  if (!open) {
    return (
      <div className="space-y-2">
        <Done message={state.message} />
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="btn btn-danger min-h-9 px-3">
          Reject<span className="sr-only"> the raise request for {name}</span>
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Reject the raise request for ${name}? The raise prepared from it goes with it.`)) e.preventDefault();
      }}
      aria-label={`Reject the raise request for ${name}`}
      className="min-w-64 space-y-3 rounded-lg border border-line bg-canvas p-4"
    >
      <FormErrors errors={state.errors} />
      <CommentField fid={fid} state={state} label="Comment" readers={commentReaders('decision', requester)} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className="btn btn-danger">
          {pending ? 'Rejecting…' : 'Reject the request'}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
