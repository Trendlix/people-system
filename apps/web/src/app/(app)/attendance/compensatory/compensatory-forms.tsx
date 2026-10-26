'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import {
  COMPENSATORY_CASH_HINT,
  COMPENSATORY_OUTCOME_LABELS,
  COMPENSATORY_OUTCOMES,
  LEAVE_DECISION_LABELS,
  LEAVE_DECISIONS,
  leaveDecisionNeedsComment,
  type CompensatoryOutcome,
  type LeaveDecision,
  type LeaveStage,
} from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import { SurfaceField } from '@/components/surface';
import type { CompensatoryCheck, CompensatoryForm, CompensatorySettings } from '@/lib/compensatory-types';
import { parseDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { choice } from '../../employees/[id]/contracts/pay-fields';
import { leaveCommentReaders } from '../../leave/list';
import { checkCompensatory } from './actions';
import {
  COMPENSATORY_REASON_MAX,
  compensatoryDecisionButton,
  compensatoryFormProblems,
  compensatoryFormWarning,
  compensatoryReadyText,
  type TypedCompensatory,
} from './compensatory';

// The forms of compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
// month. and rarely to be compensated in cash"): the employee's request (the day worked and the day off in the same month,
// a day before the day off at the latest, checked live, Send staying off while any is left; a day worked with no check-in
// kept is a warning HR confirms); HR's record for someone (a day off or cash instead, a reason, what refuses it read from
// the API as the days are chosen); an approver's decision (HR's: approve as a day off, approve as cash instead, or reject
// with a comment, confirming a day with no check-in kept); the employee's Cancel while it is being decided; HR's Cancel of
// an approved one, with a comment; and the Leave Setup's cash rate.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

function Problems({ problems, verb, ready }: { problems: readonly string[]; verb: string; ready: string }) {
  return (
    <div role="status" aria-live="polite">
      {problems.length ? (
        <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
          <p className="font-medium">Before you can {verb} it:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">{ready}</p>
      )}
    </div>
  );
}

/** The employee's request: the day worked, the day off and why, with the checks live. */
export function NewCompensatoryForm({ action, form, cancelHref, toCeo = false }: { action: Action; form: CompensatoryForm; cancelHref: string; toCeo?: boolean }) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTyped] = useState<TypedCompensatory>(() => ({ dayWorked: valueOf(state, 'dayWorked'), dayOff: valueOf(state, 'dayOff'), reason: valueOf(state, 'reason') }));
  const problems = compensatoryFormProblems(typed, form);
  const warning = compensatoryFormWarning(typed, form);
  const blocked = problems.length > 0 || sending;

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form
      onSubmit={send}
      onChange={(e) => {
        const t = e.target;
        if (t instanceof HTMLInputElement && (t.name === 'dayWorked' || t.name === 'dayOff')) setTyped((x) => ({ ...x, [t.name]: t.value }));
      }}
      aria-label="New compensatory day request"
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('dayWorked')} className="label">
            Day worked
          </label>
          <DateInput id={fid('dayWorked')} name="dayWorked" required defaultValue={typed.dayWorked} aria-describedby={fid('dayWorked-hint')} />
          <p id={fid('dayWorked-hint')} className="hint">A rest day of your shift or an official holiday you worked: today or a day gone by.</p>
        </div>
        <div>
          <label htmlFor={fid('dayOff')} className="label">
            Day off
          </label>
          <DateInput id={fid('dayOff')} name="dayOff" required defaultValue={typed.dayOff} aria-describedby={fid('dayOff-hint')} />
          <p id={fid('dayOff-hint')} className="hint">A working day in the same month as the day worked, tomorrow or later: not leave, work from home or an official holiday.</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Reason {optional}
          </label>
          <textarea
            id={fid('reason')}
            name="reason"
            rows={2}
            maxLength={COMPENSATORY_REASON_MAX}
            value={typed.reason}
            onChange={(e) => setTyped((x) => ({ ...x, reason: e.target.value }))}
            aria-describedby={fid('reason-hint')}
            className="input"
          />
          <p id={fid('reason-hint')} className="hint">Your direct manager and HR read it. Up to {COMPENSATORY_REASON_MAX} characters.</p>
        </div>
      </div>
      {warning && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{warning}</p>}
      <Problems problems={problems} verb="send" ready={compensatoryReadyText(typed, toCeo)} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={blocked} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">
          {sending ? 'Sending…' : 'Send request'}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary ${sending ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={sending || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * HR's record of a compensatory day for someone: the day worked, the day off (none when paid in cash instead) and a
 * reason; as the days are chosen, what refuses it and what it would be recorded past.
 */
export function RecordCompensatoryForm({ action, employee, cancelHref, cashDays = 1.5 }: { action: Action; employee: { id: string; name: string }; cancelHref: string; cashDays?: number }) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTyped] = useState<TypedCompensatory>(() => ({ dayWorked: valueOf(state, 'dayWorked'), dayOff: valueOf(state, 'dayOff'), reason: valueOf(state, 'reason') }));
  const [outcome, setOutcome] = useState<CompensatoryOutcome>(() => (valueOf(state, 'outcome') === 'cash' ? 'cash' : 'day_off'));
  const [check, setCheck] = useState<CompensatoryCheck | null>(null);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const asked = useRef('');
  const worked = parseDate(typed.dayWorked) || null;
  const off = parseDate(typed.dayOff) || null;

  /** What the days typed would meet, read from the API once the day worked is a date. */
  function readFor(dayWorked: string, dayOff: string, as: CompensatoryOutcome) {
    const w = parseDate(dayWorked) || '';
    const o = as === 'cash' ? '' : parseDate(dayOff) || '';
    const key = `${w}|${o}`;
    if (key === asked.current) return;
    asked.current = key;
    setCheck(null);
    setCheckProblem(null);
    if (!w) return;
    startChecking(async () => {
      const answer = await checkCompensatory(employee.id, w, o || null);
      if (asked.current !== key) return;
      if ('check' in answer) setCheck(answer.check);
      else if (answer.errors.length) setCheckProblem(`The days couldn't be checked: ${answer.errors.join(' ')} They are checked again when you record it.`);
    });
  }

  const problems: string[] = [];
  if (typed.dayWorked.trim() === '') problems.push('Enter the day they worked.');
  else if (!worked) problems.push('Enter the day worked as DD/MM/YYYY, e.g. 06/11/2026.');
  if (outcome === 'day_off') {
    if (typed.dayOff.trim() === '') problems.push('Enter the day off.');
    else if (!off) problems.push('Enter the day off as DD/MM/YYYY, e.g. 10/11/2026.');
  }
  if (!typed.reason.trim()) problems.push('Write why HR records this compensatory day.');
  if (check) problems.push(...check.problems);
  if (checking) problems.push('Checking the days…');
  const blocked = problems.length > 0 || sending;
  const warnings = check?.warnings ?? [];

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    if (warnings.length && !window.confirm(`Record it anyway? ${warnings.join(' ')}`)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form
      onSubmit={send}
      onChange={(e) => {
        const t = e.target;
        if (t instanceof HTMLInputElement && (t.name === 'dayWorked' || t.name === 'dayOff')) {
          const next = { ...typed, [t.name]: t.value };
          setTyped(next);
          readFor(next.dayWorked, next.dayOff, outcome);
        }
      }}
      aria-label={`Record a compensatory day for ${employee.name}`}
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <input type="hidden" name="employeeId" value={employee.id} />
      <fieldset>
        <legend className="label">Decision</legend>
        <div className="flex flex-wrap gap-2">
          {COMPENSATORY_OUTCOMES.map((o) => (
            <label key={o} className={choice}>
              <input
                type="radio"
                name="outcome"
                value={o}
                checked={outcome === o}
                onChange={() => {
                  setOutcome(o);
                  readFor(typed.dayWorked, typed.dayOff, o);
                }}
                className="size-4 accent-accent"
              />
              {COMPENSATORY_OUTCOME_LABELS[o]}
            </label>
          ))}
        </div>
        <p className="hint">
          {outcome === 'cash'
            ? `Cash instead: an addition of ${cashDays} ${cashDays === 1 ? 'day' : 'days'}' pay on the month's draft payroll, and no day off. ${COMPENSATORY_CASH_HINT}`
            : 'A day off: a full paid day, with nothing paid for the day worked.'}
        </p>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('dayWorked')} className="label">
            Day worked
          </label>
          <DateInput id={fid('dayWorked')} name="dayWorked" required defaultValue={typed.dayWorked} aria-describedby={fid('dayWorked-hint')} />
          <p id={fid('dayWorked-hint')} className="hint">A rest day of their shift or an official holiday, today or gone by.</p>
        </div>
        {outcome === 'day_off' && (
          <div>
            <label htmlFor={fid('dayOff')} className="label">
              Day off
            </label>
            <DateInput id={fid('dayOff')} name="dayOff" required defaultValue={typed.dayOff} aria-describedby={fid('dayOff-hint')} />
            <p id={fid('dayOff-hint')} className="hint">A working day in the same month; a day gone by is recorded with a warning.</p>
          </div>
        )}
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Reason
          </label>
          <textarea
            id={fid('reason')}
            name="reason"
            rows={2}
            required
            maxLength={COMPENSATORY_REASON_MAX}
            value={typed.reason}
            onChange={(e) => setTyped((x) => ({ ...x, reason: e.target.value }))}
            aria-describedby={fid('reason-hint')}
            className="input"
          />
          <p id={fid('reason-hint')} className="hint">E.g. worked the Friday shoot, told by phone. The employee sees it; it is kept in the audit log.</p>
        </div>
      </div>
      {checkProblem && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{checkProblem}</p>}
      {warnings.length > 0 && (
        <div role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <p className="font-medium">It is recorded with these warnings:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <Problems problems={problems} verb="record" ready={`Ready to record: approved at once for ${employee.name}, logged as recorded by HR.`} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={blocked} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">
          {sending ? 'Recording…' : warnings.length ? 'Record with the warnings' : 'Record the compensatory day'}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary ${sending ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={sending || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * An approver's decision: Approve (a comment optional), or Reject with a comment; at HR's stage the approval is a day off
 * (the default) or cash instead, and a day worked with no check-in kept needs HR's confirmation.
 */
export function CompensatoryDecisionForm({
  action,
  stage,
  name,
  confidential = false,
  noCheckIn = false,
  cashDays,
}: {
  action: Action;
  stage: LeaveStage;
  name: string;
  confidential?: boolean;
  noCheckIn?: boolean;
  cashDays: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [decision, setDecision] = useState<LeaveDecision | ''>(() => {
    const kept = valueOf(state, 'decision');
    return (LEAVE_DECISIONS as readonly string[]).includes(kept) ? (kept as LeaveDecision) : '';
  });
  const [outcome, setOutcome] = useState<CompensatoryOutcome>(() => (valueOf(state, 'outcome') === 'cash' ? 'cash' : 'day_off'));
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  const [confirmed, setConfirmed] = useState(false);
  const needsComment = decision !== '' && leaveDecisionNeedsComment(decision);
  const hrApproves = stage === 'hr' && decision === 'approve';
  const ready = decision !== '' && (!needsComment || comment.trim() !== '') && (!hrApproves || !noCheckIn || confirmed);
  const button = compensatoryDecisionButton(decision, stage, outcome, confidential);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (decision === 'reject' && !window.confirm(`Reject the compensatory day request by ${name}? Your comment shows on it.`)) e.preventDefault();
      }}
      aria-label={`Decide on the compensatory day request by ${name}`}
      className="space-y-4"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <fieldset>
        <legend className="label">Decision</legend>
        <div className="flex flex-wrap gap-2">
          {LEAVE_DECISIONS.map((d) => (
            <label key={d} className={choice}>
              <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="size-4 accent-accent" />
              {LEAVE_DECISION_LABELS[d]}
            </label>
          ))}
        </div>
      </fieldset>
      {hrApproves && (
        <fieldset>
          <legend className="label">Approve as</legend>
          <div className="flex flex-wrap gap-2">
            {COMPENSATORY_OUTCOMES.map((o) => (
              <label key={o} className={choice}>
                <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="size-4 accent-accent" />
                {o === 'day_off' ? 'A day off' : 'Cash instead'}
              </label>
            ))}
          </div>
          <p className="hint">
            {outcome === 'cash'
              ? `Cash instead (rarely): an addition of ${cashDays} ${cashDays === 1 ? 'day' : 'days'}' pay on the draft payroll of the month, and no day off. ${COMPENSATORY_CASH_HINT}`
              : 'A day off (the default): a full paid day, and nothing is paid for the day worked.'}
          </p>
        </fieldset>
      )}
      {hrApproves && noCheckIn && (
        <label className="flex items-start gap-3 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <input type="checkbox" name="confirmNoCheckIn" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-accent" />
          <span>No check-in is kept on the day worked. I confirm it was worked.</span>
        </label>
      )}
      <div>
        <label htmlFor={fid('comment')} className="label">
          Comment {decision !== 'reject' && optional}
        </label>
        <textarea
          id={fid('comment')}
          name="comment"
          rows={3}
          maxLength={1000}
          required={needsComment}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-describedby={fid('comment-hint')}
          className="input"
        />
        <p id={fid('comment-hint')} className="hint">
          {decision === 'reject' ? 'Why it is rejected. ' : ''}
          {leaveCommentReaders(confidential)}
        </p>
      </div>
      <button type="submit" disabled={pending || !ready} className={`btn ${decision === 'reject' ? 'btn-danger' : 'btn-primary'} disabled:cursor-not-allowed disabled:opacity-60`}>
        {pending ? button.busy : button.label}
      </button>
    </form>
  );
}

/** The employee's Cancel while it is being decided: asks first; it stays on their list, cancelled. */
export function CancelCompensatoryForm({ action, what }: { action: () => Promise<FormState>; what: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Cancel your ${what}? It stays on your list, cancelled; ask again with a new request.`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Cancelling…' : 'Cancel this request'}
      </button>
    </form>
  );
}

/** HR's Cancel of an approved one, with the comment the employee reads. */
export function HrCancelCompensatoryForm({ action, what }: { action: Action; what: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Cancel the approved ${what}? The day off is a working day again, or its addition leaves the draft payroll; your comment shows on it.`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <div>
        <label htmlFor={fid('comment')} className="label">
          Why it is cancelled
        </label>
        <textarea
          id={fid('comment')}
          name="comment"
          rows={2}
          maxLength={1000}
          required
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-describedby={fid('comment-hint')}
          className="input"
        />
        <p id={fid('comment-hint')} className="hint">E.g. recorded by mistake, or the day worked was not worked. The employee sees it.</p>
      </div>
      <button type="submit" disabled={pending || comment.trim() === ''} className="btn btn-danger">
        {pending ? 'Cancelling…' : 'Cancel the compensatory day'}
      </button>
    </form>
  );
}

/** The Leave Setup's cash rate (owner, 26 October 2026: "if paid in cash make it 1.5"). */
export function CompensatorySettingsForm({ action, settings, canEdit }: { action: Action; settings: CompensatorySettings; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} aria-label="Compensatory day cash rate" className="space-y-4">
      <FormErrors errors={state.errors} />
      {state.message && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {state.message}
        </p>
      )}
      <div className="max-w-sm">
        <label htmlFor={fid('cashRate')} className="label">
          Cash instead of a day off: days&apos; pay
        </label>
        <input
          id={fid('cashRate')}
          name="cashRate"
          type="number"
          inputMode="decimal"
          min={0.5}
          max={5}
          step={0.5}
          required
          disabled={!canEdit}
          defaultValue={valueOf(state, 'cashRate') || String(settings.cashRate)}
          aria-describedby={fid('cashRate-hint')}
          className="input"
        />
        <p id={fid('cashRate-hint')} className="hint">
          The days&apos; pay added to the payroll when HR approves a compensatory day as cash instead, for a rest day and an official holiday alike: whole or
          half days. {COMPENSATORY_CASH_HINT}
        </p>
      </div>
      {canEdit && (
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save the cash rate'}
        </button>
      )}
    </form>
  );
}
