'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import { COMPENSATORY_OUTCOMES, LEAVE_DECISION_LABELS, LEAVE_DECISIONS, leaveDecisionNeedsComment, type CompensatoryRules, type LeaveDecision, type LeaveStage } from '@trendlix/shared';
import { DateInput, TimeInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import { SurfaceField } from '@/components/surface';
import { formatTime } from '@/lib/format';
import type { OdCheck, OdCompensationView, OdForm } from '@/lib/od-types';
import type { FormState } from '@/lib/types';
import { choice } from '../../employees/[id]/contracts/pay-fields';
import { leaveCommentReaders } from '../../leave/list';
import { checkOdDays } from './actions';
import {
  OD_PLACE_MAX,
  OD_REASON_MAX,
  odAfterNote,
  odAskedOf,
  odCashHint,
  odCheckPath,
  odCompensatedAlready,
  odCompensationLead,
  odDayOffHint,
  odDecisionButton,
  odFormCompensation,
  odFormProblems,
  odReadyText,
  odRecordProblems,
  odRecordReadyText,
  odSent,
  odWhenOf,
  type TypedOd,
} from './od';

// The forms of official duty (owner, 23 October 2026: "Official duty (OD) requests"; asked, "Manager, then HR", "Ahead
// or up to 3 days after", "Check in from anywhere"): the employee's request (the first day and, for several days in a
// row, the last; a full day or part of one with its times, one day only; where and why), with the timing and the hours
// against their shift checked live and Send staying off while any is left; what only the API knows (leave, a work from
// home day or another official duty on the same days) it refuses when sent, shown here with what was typed; a first day
// gone by is marked "requested after". HR's record for someone (owner, 26 October 2026: "HR records it"): the same
// fields, the days checked by the API live as they are chosen (what refuses them, and what they would be recorded past:
// more than 3 days after, asked to confirm), approved at once. A single rest day or official holiday (owner, 27 October
// 2026, on HR's form refusing a rest day: "it should count in the compensatories"; he chose "One step") asks right there
// for its compensation: a day off (or, for part of the day, hours off on a working day) or cash instead, saved and
// decided with the duty (CompensationFields): the employee's form tells the day from their working days and the
// holidays it read first, HR's from the API's check. An approver's decision (Approve, or Reject with a comment); the
// employee's Cancel while it is being decided; HR's Cancel of an approved one, with a comment.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

/** The fields typed into uncontrolled inputs, kept for the checks: the days, the times, and a day off's date. */
const TYPED_FIELDS = ['startDate', 'endDate', 'fromTime', 'toTime', 'dayOff'];

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

/**
 * The compensation of a single rest day or official holiday (owner, 27 October 2026: "it should count in the
 * compensatories"; "One step"): what the day earns, then Day off (Hours off for part of the day) or Cash instead and the
 * day off's date; for a day compensated already, or part of it below the Setup's minimum, only what it is. `what`: the
 * day, when known; `rules`: the Compensatory Setup, when known; `hr`: HR records it.
 */
function CompensationFields({
  comp,
  what,
  rules,
  hr,
  typed,
  setTyped,
  fid,
}: {
  comp: OdCompensationView;
  what: string | null;
  rules: CompensatoryRules | null;
  hr: boolean;
  typed: TypedOd;
  setTyped: (next: TypedOd) => void;
  fid: (name: string) => string;
}) {
  const lead = odCompensationLead(comp, what, rules);
  if (!comp.needed) return lead ? <p className="rounded-lg bg-canvas px-4 py-3 text-sm">{lead}</p> : null;
  const hours = comp.earned?.kind === 'hours';
  return (
    <fieldset className="space-y-3 rounded-lg border border-line px-4 pt-1 pb-4">
      <legend className="label px-1">Compensation</legend>
      <p className="text-sm">{lead}</p>
      <div className="flex flex-wrap gap-2">
        {COMPENSATORY_OUTCOMES.map((o) => (
          <label key={o} className={choice}>
            <input type="radio" name="compensation" value={o} checked={typed.compensation === o} onChange={() => setTyped({ ...typed, compensation: o })} className="size-4 accent-accent" />
            {o === 'cash' ? 'Cash instead' : hours ? 'Hours off' : 'Day off'}
          </label>
        ))}
      </div>
      {typed.compensation === 'day_off' && (
        <div className="sm:max-w-xs">
          <label htmlFor={fid('dayOff')} className="label">
            {hours ? 'Day for the hours off' : 'Day off'}
          </label>
          <DateInput id={fid('dayOff')} name="dayOff" required defaultValue={typed.dayOff ?? ''} aria-describedby={fid('dayOff-hint')} />
          <p id={fid('dayOff-hint')} className="hint">
            {odDayOffHint(comp, rules, hr)}
          </p>
        </div>
      )}
      {typed.compensation === 'cash' && <p className="hint">{odCashHint(comp, rules?.cashRate ?? null)}</p>}
    </fieldset>
  );
}

/** The employee's request: the days, full or part of a day, where and why, a single day off's compensation, with the checks live. */
export function NewOdForm({ action, form, cancelHref }: { action: Action; form: OdForm; cancelHref: string }) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTyped] = useState<TypedOd>(() => ({
    startDate: valueOf(state, 'startDate'),
    endDate: valueOf(state, 'endDate'),
    span: valueOf(state, 'span') || 'full',
    fromTime: valueOf(state, 'fromTime'),
    toTime: valueOf(state, 'toTime'),
    place: valueOf(state, 'place'),
    reason: valueOf(state, 'reason'),
    // a day off unless cash is chosen, as a compensatory day is approved by default (26 October 2026)
    compensation: valueOf(state, 'compensation') || 'day_off',
    dayOff: valueOf(state, 'dayOff'),
  }));
  // a day the API said a compensatory day compensates already (asked apart, before): no compensation is asked for it
  const done = odCompensatedAlready(state.errors);
  // a single rest day or official holiday (27 October 2026): what it earns, from the working days and holidays read first
  const comp = odFormCompensation(typed, form, done);
  const problems = odFormProblems(typed, form, done);
  const after = odAfterNote(typed, form);
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
        // the days and times typed, for the checks (those fields stay uncontrolled)
        const t = e.target;
        if (t instanceof HTMLInputElement && TYPED_FIELDS.includes(t.name)) setTyped((x) => ({ ...x, [t.name]: t.value }));
      }}
      aria-label="New official duty request"
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      {form.shift && (
        <p className="rounded-lg bg-canvas px-4 py-3 text-sm">
          Your shift is {formatTime(form.shift.startTime)} to {formatTime(form.shift.endTime)}: part of a day is within it. Asked ahead, today or up to 3 days after.
        </p>
      )}
      <OdFields
        typed={typed}
        setTyped={setTyped}
        fid={fid}
        dayHint="A working day of your shift, or a single rest day or official holiday with its compensation: ahead, today, or up to 3 days gone by."
        timesHint="Within your shift. Within these hours you check in from where you are; outside them, as on any day."
        reasonHint="What the duty is for. Your direct manager and HR read it."
        compensation={comp && <CompensationFields comp={comp} what={comp.what} rules={form.rules ?? null} hr={false} typed={typed} setTyped={setTyped} fid={fid} />}
      />
      {after && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{after}</p>}
      <Problems problems={problems} verb="send" ready={odReadyText(typed, form.toCeo, comp, form.rules?.cashRate ?? null)} />
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
 * The fields both forms share: how long, the days or the day and its times, a single day off's compensation
 * (`compensation`: CompensationFields, when the day is one), where and why.
 */
function OdFields({
  typed,
  setTyped,
  fid,
  dayHint,
  timesHint,
  reasonHint,
  compensation,
}: {
  typed: TypedOd;
  setTyped: (next: TypedOd) => void;
  fid: (name: string) => string;
  dayHint: string;
  timesHint: string;
  reasonHint: string;
  compensation?: React.ReactNode;
}) {
  const part = typed.span === 'part';
  return (
    <>
      <fieldset>
        <legend className="label">How long</legend>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'full', label: 'Full days' },
            { value: 'part', label: 'Part of a day' },
          ].map((o) => (
            <label key={o.value} className={choice}>
              <input type="radio" name="span" value={o.value} checked={typed.span === o.value} onChange={() => setTyped({ ...typed, span: o.value })} className="size-4 accent-accent" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('startDate')} className="label">
            {part ? 'Day' : 'First day'}
          </label>
          <DateInput id={fid('startDate')} name="startDate" required defaultValue={typed.startDate} aria-describedby={fid('startDate-hint')} />
          <p id={fid('startDate-hint')} className="hint">
            {dayHint}
          </p>
        </div>
        {part ? (
          <>
            <div>
              <label htmlFor={fid('fromTime')} className="label">
                From
              </label>
              <TimeInput id={fid('fromTime')} name="fromTime" required defaultValue={typed.fromTime} aria-describedby={fid('times-hint')} />
            </div>
            <div>
              <label htmlFor={fid('toTime')} className="label">
                To
              </label>
              <TimeInput id={fid('toTime')} name="toTime" required defaultValue={typed.toTime} aria-describedby={fid('times-hint')} />
            </div>
            <p id={fid('times-hint')} className="hint -mt-3 sm:col-span-2">
              {timesHint}
            </p>
          </>
        ) : (
          <div>
            <label htmlFor={fid('endDate')} className="label">
              Last day {optional}
            </label>
            <DateInput id={fid('endDate')} name="endDate" defaultValue={typed.endDate} aria-describedby={fid('endDate-hint')} />
            <p id={fid('endDate-hint')} className="hint">
              For several days in a row, up to 31: their official holidays and rest days aren&apos;t duty days. A single rest day or official holiday goes on
              its own, with its compensation.
            </p>
          </div>
        )}
        {compensation && <div className="sm:col-span-2">{compensation}</div>}
        <div className="sm:col-span-2">
          <label htmlFor={fid('place')} className="label">
            Where
          </label>
          <input
            id={fid('place')}
            name="place"
            required
            maxLength={OD_PLACE_MAX}
            value={typed.place}
            onChange={(e) => setTyped({ ...typed, place: e.target.value })}
            aria-describedby={fid('place-hint')}
            className="input"
          />
          <p id={fid('place-hint')} className="hint">E.g. the client’s office in New Cairo, or the shoot’s location. Up to {OD_PLACE_MAX} characters.</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Reason
          </label>
          <textarea
            id={fid('reason')}
            name="reason"
            rows={3}
            required
            maxLength={OD_REASON_MAX}
            value={typed.reason}
            onChange={(e) => setTyped({ ...typed, reason: e.target.value })}
            aria-describedby={fid('reason-hint')}
            className="input"
          />
          <p id={fid('reason-hint')} className="hint">
            {reasonHint} Up to {OD_REASON_MAX} characters.
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * HR's record for someone (owner, 26 October 2026: "HR records it"): the days, full or part of a day, where and why, with
 * what the API says of the days as they are chosen; past the 3-day limit it asks to confirm and records it with the
 * warning. Approved at once. A single rest day or official holiday (27 October 2026: "it should count in the
 * compensatories") asks for its compensation while the API's check says one is needed, the check run again with it as
 * it is chosen. `rules`: the Compensatory Setup, for its words (null when it couldn't be read).
 */
export function RecordOdForm({
  action,
  employee,
  cancelHref,
  rules = null,
}: {
  action: Action;
  employee: { id: string; name: string };
  cancelHref: string;
  rules?: CompensatoryRules | null;
}) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTypedState] = useState<TypedOd>(() => ({
    startDate: valueOf(state, 'startDate'),
    endDate: valueOf(state, 'endDate'),
    span: valueOf(state, 'span') || 'full',
    fromTime: valueOf(state, 'fromTime'),
    toTime: valueOf(state, 'toTime'),
    place: valueOf(state, 'place'),
    reason: valueOf(state, 'reason'),
    // a day off unless cash is chosen, as a compensatory day is approved by default (26 October 2026)
    compensation: valueOf(state, 'compensation') || 'day_off',
    dayOff: valueOf(state, 'dayOff'),
  }));
  const [check, setCheck] = useState<OdCheck | null>(null);
  // what a single rest day or official holiday earns: the last check's, kept shown while the days are checked again
  const [comp, setComp] = useState<OdCompensationView | null>(null);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const asked = useRef('');
  const needed = comp?.needed === true;

  /**
   * What the days typed would meet, read from the API once they can be read; with the compensation chosen while one is
   * needed (`withCompensation`). When the answer says otherwise (a rest day chosen, or a working day again), it is read
   * again the other way.
   */
  function readFor(next: TypedOd, withCompensation: boolean) {
    const when = odWhenOf(next);
    const chosen = withCompensation ? odAskedOf(next) : null;
    const path = when ? odCheckPath(employee.id, when, chosen) : '';
    if (path === asked.current) return;
    asked.current = path;
    setCheck(null);
    setCheckProblem(null);
    if (!when) {
      setComp(null);
      return;
    }
    startChecking(async () => {
      const answer = await checkOdDays(employee.id, when, chosen);
      if (asked.current !== path) return;
      if ('check' in answer) {
        setCheck(answer.check);
        const found = answer.check.compensation ?? null;
        setComp(found);
        if ((found?.needed === true) !== withCompensation) readFor(next, found?.needed === true);
      } else if (answer.errors.length) setCheckProblem(`The days couldn't be checked: ${answer.errors.join(' ')} They are checked again when you record it.`);
    });
  }

  function setTyped(next: TypedOd) {
    setTypedState(next);
    readFor(next, needed);
  }

  // its compensation goes only while one is needed
  const problems = odRecordProblems(odSent(typed, needed), check);
  if (checking) problems.push('Checking the days…');
  const blocked = problems.length > 0 || sending;
  const warnings = check?.warnings ?? [];
  const shift = check?.shift ?? null;

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
        // the days and times typed, for the checks (those fields stay uncontrolled)
        const t = e.target;
        if (t instanceof HTMLInputElement && TYPED_FIELDS.includes(t.name)) setTyped({ ...typed, [t.name]: t.value });
      }}
      aria-label={`Record official duty for ${employee.name}`}
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <input type="hidden" name="employeeId" value={employee.id} />
      {shift && (
        <p className="rounded-lg bg-canvas px-4 py-3 text-sm">
          {employee.name}&apos;s shift is {formatTime(shift.startTime)} to {formatTime(shift.endTime)}: part of a day is within it.
        </p>
      )}
      <OdFields
        typed={typed}
        setTyped={setTyped}
        fid={fid}
        dayHint="Any working day of their shift, or a single rest day or official holiday with its compensation, ahead or gone by: more than 3 days after, it is recorded with a warning."
        timesHint="Within their shift. Within these hours they check in from where they are; outside them, as on any day."
        reasonHint="What the duty is for, and why HR records it, e.g. a site visit agreed by phone. The employee sees it; it is kept in the audit log."
        compensation={comp?.onDayOff && <CompensationFields comp={comp} what={null} rules={rules} hr typed={typed} setTyped={setTyped} fid={fid} />}
      />
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
      <Problems problems={problems} verb="record" ready={odRecordReadyText(typed, employee.name, comp, rules?.cashRate ?? null)} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={blocked} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">
          {sending ? 'Recording…' : warnings.length ? 'Record with the warnings' : 'Record the official duty'}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary ${sending ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={sending || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** An approver's decision: Approve (a comment optional), or Reject with a comment; rejecting asks first. */
export function OdDecisionForm({ action, stage, name, confidential = false }: { action: Action; stage: LeaveStage; name: string; confidential?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [decision, setDecision] = useState<LeaveDecision | ''>(() => {
    const kept = valueOf(state, 'decision');
    return (LEAVE_DECISIONS as readonly string[]).includes(kept) ? (kept as LeaveDecision) : '';
  });
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  const needsComment = decision !== '' && leaveDecisionNeedsComment(decision);
  const ready = decision !== '' && (!needsComment || comment.trim() !== '');
  const button = odDecisionButton(decision, stage, confidential);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (decision === 'reject' && !window.confirm(`Reject the official duty request by ${name}? Your comment shows on it.`)) e.preventDefault();
      }}
      aria-label={`Decide on the official duty request by ${name}`}
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
export function CancelOdForm({ action, what }: { action: () => Promise<FormState>; what: string }) {
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

/** HR's Cancel of an approved official duty, with the comment the employee reads. */
export function HrCancelOdForm({ action, what }: { action: Action; what: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Cancel the approved ${what}? Its days are expected as usual again; your comment shows on it.`)) e.preventDefault();
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
        <p id={fid('comment-hint')} className="hint">E.g. the client visit was called off. The employee sees it.</p>
      </div>
      <button type="submit" disabled={pending || comment.trim() === ''} className="btn btn-danger">
        {pending ? 'Cancelling…' : 'Cancel the official duty'}
      </button>
    </form>
  );
}
