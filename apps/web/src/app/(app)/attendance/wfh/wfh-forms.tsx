'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import { LEAVE_DECISION_LABELS, LEAVE_DECISIONS, leaveDecisionNeedsComment, WFH_DAYS_PER_MONTH_MAX, WFH_GAP_DAYS_MAX, type LeaveDecision, type LeaveStage } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import { SurfaceField } from '@/components/surface';
import { parseDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import type { WfhAllowance, WfhCheck, WfhSettings } from '@/lib/wfh-types';
import { choice } from '../../employees/[id]/contracts/pay-fields';
import { checkWfhDay } from './actions';
import { WFH_REASON_MAX, wfhAllowanceLine, wfhDecisionButton, wfhFormProblems, type TypedWfh } from './wfh';

// The forms of working from home (owner, 21 October 2026: "think about how should we handle the working from home in
// out erp"): the employee's request (one day, a day before at the latest, with "x of 2 this month · next possible from
// DD/MM/YYYY" and the notice and the limits checked live, Send staying off while any is left; what only the API knows, a
// working office day of theirs, a holiday or a day of leave, it refuses when sent, shown here with what was typed);
// HR's record for someone (the day and a reason, what refuses it and the warnings it would be recorded past read from
// the API as the day is chosen); an approver's decision (Approve, or Reject with a comment); the employee's Cancel while
// it is being decided; HR's Cancel of an approved day, with a comment; and the Leave Setup's two limits.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

function Problems({ problems, verb }: { problems: readonly string[]; verb: string }) {
  return (
    <div role="status" aria-live="polite">
      {problems.length > 0 && (
        <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
          <p className="font-medium">Before you can {verb} it:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The employee's request: the day and why, with their month's days and the checks live. */
export function NewWfhForm({
  action,
  allowance,
  cancelHref,
}: {
  action: Action;
  /** Their month (this month's), with their days around it and the next day possible. */
  allowance: WfhAllowance;
  cancelHref: string;
}) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTyped] = useState<TypedWfh>(() => ({ date: valueOf(state, 'date'), reason: valueOf(state, 'reason') }));
  const date = parseDate(typed.date) || null;
  const problems = wfhFormProblems(typed, allowance);
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
        // the day typed, for the checks (the field stays uncontrolled)
        const t = e.target;
        if (t instanceof HTMLInputElement && t.name === 'date') setTyped((x) => ({ ...x, date: t.value }));
      }}
      aria-label="New work from home request"
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <div role="status" aria-live="polite" className="rounded-lg bg-canvas px-4 py-3 text-sm">
        <p className="font-semibold tabular-nums">{wfhAllowanceLine(allowance, date)}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('date')} className="label">
            Day
          </label>
          <DateInput id={fid('date')} name="date" required defaultValue={typed.date} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Reason {optional}
          </label>
          <textarea
            id={fid('reason')}
            name="reason"
            rows={2}
            maxLength={WFH_REASON_MAX}
            value={typed.reason}
            onChange={(e) => setTyped((x) => ({ ...x, reason: e.target.value }))}
            className="input"
          />
        </div>
      </div>
      <Problems problems={problems} verb="send" />
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
 * HR's record of a day for someone (owner's brief, 21 October 2026: past, the same day or over the limit, "with a warning
 * and a reason"): the day and the reason; as the day is chosen, what refuses it and what it would be recorded past. On
 * Record leave (owner, 26 October 2026: "YES move it to leaves") with its Type first (`typeField`), Work from home chosen.
 */
export function RecordWfhForm({
  action,
  employee,
  cancelHref,
  typeField,
}: {
  action: Action;
  employee: { id: string; name: string };
  cancelHref: string;
  /** A field shown first, sent with nothing: Record leave's types, Work from home chosen (26 October 2026). */
  typeField?: React.ReactNode;
}) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTyped] = useState<TypedWfh>(() => ({ date: valueOf(state, 'date'), reason: valueOf(state, 'reason') }));
  const [check, setCheck] = useState<WfhCheck | null>(null);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const asked = useRef('');
  const date = parseDate(typed.date) || null;

  /** What the day typed would meet, read from the API once it is a date. */
  function readFor(typedDate: string) {
    const wanted = parseDate(typedDate) || '';
    if (wanted === asked.current) return;
    asked.current = wanted;
    setCheck(null);
    setCheckProblem(null);
    if (!wanted) return;
    startChecking(async () => {
      const answer = await checkWfhDay(employee.id, wanted);
      if (asked.current !== wanted) return;
      if ('check' in answer) setCheck(answer.check);
      else if (answer.errors.length) setCheckProblem(`The day couldn't be checked: ${answer.errors.join(' ')}`);
    });
  }

  const problems: string[] = [];
  if (typed.date.trim() === '') problems.push('Enter the day they work from home.');
  else if (!date) problems.push('Enter the day as DD/MM/YYYY, e.g. 02/11/2026.');
  if (!typed.reason.trim()) problems.push('Write why HR records this day.');
  if (check) problems.push(...check.problems);
  if (checking) problems.push('Checking the day…');
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
        if (t instanceof HTMLInputElement && t.name === 'date') {
          setTyped((x) => ({ ...x, date: t.value }));
          readFor(t.value);
        }
      }}
      aria-label={`Record a work from home day for ${employee.name}`}
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <input type="hidden" name="employeeId" value={employee.id} />
      {typeField}
      {check && (
        <p className="rounded-lg bg-canvas px-4 py-3 text-sm tabular-nums">
          {employee.name}: {check.used} of {check.daysPerMonth} in that month.
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('date')} className="label">
            Day
          </label>
          <DateInput id={fid('date')} name="date" required defaultValue={typed.date} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Reason
          </label>
          <textarea
            id={fid('reason')}
            name="reason"
            rows={2}
            required
            maxLength={WFH_REASON_MAX}
            value={typed.reason}
            onChange={(e) => setTyped((x) => ({ ...x, reason: e.target.value }))}
            className="input"
          />
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
      <Problems problems={problems} verb="record" />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={blocked} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">
          {sending ? 'Recording…' : warnings.length ? 'Record with the warnings' : 'Record the day'}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary ${sending ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={sending || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** An approver's decision: Approve (a comment optional), or Reject with a comment; rejecting asks first. */
export function WfhDecisionForm({ action, stage, name, confidential = false }: { action: Action; stage: LeaveStage; name: string; confidential?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [decision, setDecision] = useState<LeaveDecision | ''>(() => {
    const kept = valueOf(state, 'decision');
    return (LEAVE_DECISIONS as readonly string[]).includes(kept) ? (kept as LeaveDecision) : '';
  });
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  const needsComment = decision !== '' && leaveDecisionNeedsComment(decision);
  const ready = decision !== '' && (!needsComment || comment.trim() !== '');
  const button = wfhDecisionButton(decision, stage, confidential);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (decision === 'reject' && !window.confirm(`Reject the work from home request by ${name}?`)) e.preventDefault();
      }}
      aria-label={`Decide on the work from home request by ${name}`}
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
          className="input"
        />
      </div>
      <button type="submit" disabled={pending || !ready} className={`btn ${decision === 'reject' ? 'btn-danger' : 'btn-primary'} disabled:cursor-not-allowed disabled:opacity-60`}>
        {pending ? button.busy : button.label}
      </button>
    </form>
  );
}

/** The employee's Cancel while it is being decided: asks first; it stays on their list, cancelled. */
export function CancelWfhForm({ action, what }: { action: () => Promise<FormState>; what: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Cancel your ${what}?`)) e.preventDefault();
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

/** HR's Cancel of an approved day, with the comment the employee reads. */
export function HrCancelWfhForm({ action, what }: { action: Action; what: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Cancel the approved ${what}?`)) e.preventDefault();
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
          className="input"
        />
      </div>
      <button type="submit" disabled={pending || comment.trim() === ''} className="btn btn-danger">
        {pending ? 'Cancelling…' : 'Cancel the work from home day'}
      </button>
    </form>
  );
}

/** The Leave Setup's limits (owner, 21 October 2026: "its 2 days per month with a gap of 1 week between each record"). */
export function WfhSettingsForm({ action, settings, canEdit }: { action: Action; settings: WfhSettings; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const kept = (key: string, fallback: number) => valueOf(state, key) || String(fallback);
  return (
    <form action={formAction} aria-label="Work from home limits" className="space-y-4">
      <FormErrors errors={state.errors} />
      {state.message && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {state.message}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('daysPerMonth')} className="label">
            Days a month
          </label>
          <input
            id={fid('daysPerMonth')}
            name="daysPerMonth"
            type="number"
            inputMode="numeric"
            min={0}
            max={WFH_DAYS_PER_MONTH_MAX}
            step={1}
            required
            disabled={!canEdit}
            defaultValue={kept('daysPerMonth', settings.daysPerMonth)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor={fid('minGapDays')} className="label">
            Days between two
          </label>
          <input
            id={fid('minGapDays')}
            name="minGapDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={WFH_GAP_DAYS_MAX}
            step={1}
            required
            disabled={!canEdit}
            defaultValue={kept('minGapDays', settings.minGapDays)}
            className="input"
          />
        </div>
      </div>
      {canEdit && (
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save the limits'}
        </button>
      )}
    </form>
  );
}
