'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import {
  COMPENSATORY_CASH_HINT,
  COMPENSATORY_OFF_WITHIN_MAX,
  compensatoryNoEligibleText,
  COMPENSATORY_OUTCOME_LABELS,
  COMPENSATORY_OUTCOMES,
  compensationEarned,
  hoursWorkedProblems,
  LEAVE_DECISION_LABELS,
  LEAVE_DECISIONS,
  leaveDecisionNeedsComment,
  type CompensationEarned,
  type CompensatoryOutcome,
  type CompensatoryRules,
  type LeaveDecision,
  type LeaveStage,
} from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { SurfaceField } from '@/components/surface';
import type { CompensatoryCheck, CompensatoryForm } from '@/lib/compensatory-types';
import { parseDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { choice } from '../../employees/[id]/contracts/pay-fields';
import { leaveCommentReaders } from '../../leave/list';
import { checkCompensatory } from './actions';
import {
  COMPENSATORY_DAY_WORKED_HINT,
  COMPENSATORY_REASON_MAX,
  compensatoryCashWaitsText,
  compensatoryDayGroups,
  compensatoryDayOffField,
  compensatoryDecisionButton,
  compensatoryEligibleOf,
  compensatoryEarnsText,
  compensatoryFormProblems,
  compensatoryFormWarning,
  compensatoryOutcomeHint,
  compensatoryReadyText,
  compensatoryRecordCashText,
  compensatoryRulesOf,
  compensatoryRulesText,
  compensatorySetupRows,
  readCompensatorySetup,
  readHoursWorked,
  typedSetupOf,
  type TypedCompensatory,
  type TypedCompensatorySetup,
  type WorkedPart,
} from './compensatory';

// The forms of compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
// month. and rarely to be compensated in cash"): the employee's request (the day worked and the day off in the Setup's
// window, a day before the day off at the latest, checked live, Send staying off while any is left; a day worked with no
// check-in kept is a warning HR confirms); HR's record for someone (a day off or cash instead, a reason, what refuses it
// read from the API as the days are chosen); an approver's decision (HR's: approve as a day off, approve as cash instead,
// or reject with a comment, confirming a day with no check-in kept); the employee's Cancel while it is being decided; HR's
// Cancel of an approved one, with a comment. Part of a day worked (owner, 27 October 2026: "Hours off for hours worked"):
// both request forms ask the hours worked, the whole day unless part of it is chosen, and say live what they earn by the
// Compensatory Setup; and the Setup itself ("i need a setup dashboard for the compensatory leaves"), HR's to change.
// The employee picks the day worked from a menu (owner, 31 October 2026: "let the employee pick from a drop menu the
// eligable day, or choose a future day in the same month only, for upcomming days"); HR approves one still to come as a
// day off, cash instead waiting for the day.

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

/** The fields as typed the first time the form shows (again, after a refusal). */
const typedFrom = (state: FormState): TypedCompensatory => ({
  dayWorked: valueOf(state, 'dayWorked'),
  dayOff: valueOf(state, 'dayOff'),
  reason: valueOf(state, 'reason'),
  part: valueOf(state, 'part') === 'part' ? 'part' : 'whole',
  hours: valueOf(state, 'hoursWorked'),
});

/**
 * The hours worked on the day (owner, 27 October 2026: "Hours off for hours worked"): the whole day (the default) or part
 * of it with its hours (e.g. 4 or 3.5), and what they earn by the Setup, said live.
 */
function HoursWorkedField({
  fid,
  typed,
  rules,
  onChange,
}: {
  fid: (name: string) => string;
  typed: TypedCompensatory;
  rules: CompensatoryRules;
  onChange: (next: { part: WorkedPart; hours: string }) => void;
}) {
  const part = typed.part ?? 'whole';
  const hours = typed.hours ?? '';
  const read = readHoursWorked(part, hours);
  const earns = read.error ? 'The hours worked that day, e.g. 4 or 3.5.' : compensatoryEarnsText(read.hoursWorked, rules);
  return (
    <fieldset>
      <legend className="label">Hours worked</legend>
      <div className="flex flex-wrap items-center gap-2">
        {(['whole', 'part'] as const).map((p) => (
          <label key={p} className={choice}>
            <input type="radio" name="part" value={p} checked={part === p} onChange={() => onChange({ part: p, hours })} className="size-4 accent-accent" />
            {p === 'whole' ? 'The whole day' : 'Part of the day'}
          </label>
        ))}
        {part === 'part' && (
          <span className="flex items-center gap-2">
            <label htmlFor={fid('hoursWorked')} className="sr-only">
              Hours worked that day
            </label>
            <input
              id={fid('hoursWorked')}
              name="hoursWorked"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              placeholder="e.g. 4"
              value={hours}
              onChange={(e) => onChange({ part, hours: e.target.value })}
              aria-describedby={fid('hoursWorked-hint')}
              className="input w-24"
            />
            <span className="text-sm text-muted">hours</span>
          </span>
        )}
      </div>
      <p id={fid('hoursWorked-hint')} className="hint" aria-live="polite">
        <span className="font-medium text-ink">{earns}</span>
        {part === 'part' && <span className="block">{compensatoryRulesText(rules)}</span>}
      </p>
    </fieldset>
  );
}

/** The employee's request: the day worked, the hours worked, the day off and why, with the checks live. */
export function NewCompensatoryForm({ action, form, cancelHref, toCeo = false }: { action: Action; form: CompensatoryForm; cancelHref: string; toCeo?: boolean }) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTyped] = useState<TypedCompensatory>(() => typedFrom(state));
  const rules = compensatoryRulesOf(form.rules);
  const hours = readHoursWorked(typed.part, typed.hours);
  const offField = compensatoryDayOffField(hours.error ? null : compensationEarned(hours.hoursWorked, rules), rules, 'employee');
  // the days the day worked is picked from, worked and to come this month (31 October 2026)
  const groups = compensatoryDayGroups(compensatoryEligibleOf(form));
  const offered = groups.some((g) => g.options.some((o) => o.value === typed.dayWorked));
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
          {groups.length ? (
            <>
              <Select
                id={fid('dayWorked')}
                name="dayWorked"
                required
                value={offered ? typed.dayWorked : ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setTyped((x) => ({ ...x, dayWorked: value }));
                }}
                aria-describedby={fid('dayWorked-hint')}
                className="input"
              >
                <option value="">Choose the day worked</option>
                {groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <p id={fid('dayWorked-hint')} className="hint">
                {COMPENSATORY_DAY_WORKED_HINT}
              </p>
            </>
          ) : (
            <p id={fid('dayWorked')} className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm text-muted">
              {compensatoryNoEligibleText(form.today, rules.offWithinDays)}
            </p>
          )}
        </div>
        <HoursWorkedField fid={fid} typed={typed} rules={rules} onChange={(next) => setTyped((x) => ({ ...x, ...next }))} />
        <div>
          <label htmlFor={fid('dayOff')} className="label">
            {offField.label}
          </label>
          <DateInput id={fid('dayOff')} name="dayOff" required defaultValue={typed.dayOff} aria-describedby={fid('dayOff-hint')} />
          <p id={fid('dayOff-hint')} className="hint">
            {offField.hint}
          </p>
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
      <Problems problems={problems} verb="send" ready={compensatoryReadyText(typed, toCeo, rules)} />
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
 * HR's record of a compensatory day for someone: the day worked, the hours worked (the whole day, or part of it), the day
 * off (none when paid in cash instead) and a reason; as they are chosen, what refuses it, what it would be recorded past
 * and, for cash instead, its days' pay by their shift (GET /compensatory/check). `rules`: the Compensatory Setup's.
 */
export function RecordCompensatoryForm({ action, employee, cancelHref, rules: saved }: { action: Action; employee: { id: string; name: string }; cancelHref: string; rules?: CompensatoryRules }) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTyped] = useState<TypedCompensatory>(() => typedFrom(state));
  const [outcome, setOutcome] = useState<CompensatoryOutcome>(() => (valueOf(state, 'outcome') === 'cash' ? 'cash' : 'day_off'));
  const [check, setCheck] = useState<CompensatoryCheck | null>(null);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const asked = useRef('');
  const worked = parseDate(typed.dayWorked) || null;
  const off = parseDate(typed.dayOff) || null;
  // the Setup as the check read it, else as the page did
  const rules = compensatoryRulesOf(check?.rules ?? saved);
  const hours = readHoursWorked(typed.part, typed.hours);
  const earned: CompensationEarned | null = hours.error ? null : compensationEarned(hours.hoursWorked, rules);
  const offField = compensatoryDayOffField(earned, rules, 'hr');

  /** What the days and hours typed would meet, read from the API once the day worked is a date. */
  function readFor(next: TypedCompensatory, as: CompensatoryOutcome) {
    const w = parseDate(next.dayWorked) || '';
    const o = as === 'cash' ? '' : parseDate(next.dayOff) || '';
    const read = readHoursWorked(next.part, next.hours);
    const h = read.error ? null : read.hoursWorked;
    const key = `${w}|${o}|${h ?? ''}`;
    if (key === asked.current) return;
    asked.current = key;
    setCheck(null);
    setCheckProblem(null);
    if (!w) return;
    startChecking(async () => {
      const answer = await checkCompensatory(employee.id, w, o || null, h);
      if (asked.current !== key) return;
      if ('check' in answer) setCheck(answer.check);
      else if (answer.errors.length) setCheckProblem(`The days couldn't be checked: ${answer.errors.join(' ')} They are checked again when you record it.`);
    });
  }

  function change(next: TypedCompensatory) {
    setTyped(next);
    readFor(next, outcome);
  }

  const problems: string[] = [];
  if (typed.dayWorked.trim() === '') problems.push('Enter the day they worked.');
  else if (!worked) problems.push('Enter the day worked as DD/MM/YYYY, e.g. 06/11/2026.');
  if (hours.error) problems.push(hours.error);
  // the Setup's minimum: the check says it with the rest once it is read
  else if (!check) problems.push(...hoursWorkedProblems(hours.hoursWorked, rules, employee.name));
  if (outcome === 'day_off') {
    if (typed.dayOff.trim() === '') problems.push('Enter the day off.');
    else if (!off) problems.push('Enter the day off as DD/MM/YYYY, e.g. 10/11/2026.');
  }
  if (!typed.reason.trim()) problems.push('Write why HR records this compensatory day.');
  if (check) problems.push(...check.problems);
  if (checking) problems.push('Checking the days…');
  const blocked = problems.length > 0 || sending;
  const warnings = check?.warnings ?? [];
  const hoursOff = earned?.kind === 'hours' ? earned.hours : null;

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
        if (t instanceof HTMLInputElement && (t.name === 'dayWorked' || t.name === 'dayOff')) change({ ...typed, [t.name]: t.value });
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
                  readFor(typed, o);
                }}
                className="size-4 accent-accent"
              />
              {o === 'day_off' && hoursOff !== null ? 'Hours off' : COMPENSATORY_OUTCOME_LABELS[o]}
            </label>
          ))}
        </div>
        <p className="hint">
          {outcome === 'cash'
            ? earned
              ? compensatoryRecordCashText(earned, rules, check ? check.cashDays : null)
              : `Cash instead: the hours' pay at ${rules.cashRate}×, once the hours are typed. ${COMPENSATORY_CASH_HINT}`
            : compensatoryOutcomeHint('day_off', { dayOff: off, hoursOff }, rules.cashRate)}
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
        <HoursWorkedField fid={fid} typed={typed} rules={rules} onChange={(next) => change({ ...typed, ...next })} />
        {outcome === 'day_off' && (
          <div>
            <label htmlFor={fid('dayOff')} className="label">
              {offField.label}
            </label>
            <DateInput id={fid('dayOff')} name="dayOff" required defaultValue={typed.dayOff} aria-describedby={fid('dayOff-hint')} />
            <p id={fid('dayOff-hint')} className="hint">
              {offField.hint}
            </p>
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
 * (the default; hours off for part of a day worked, 27 October 2026) or cash instead (a whole day's rate, or the hours' pay
 * at it), and a day worked with no check-in kept needs HR's confirmation. A day worked still to come, asked ahead (31
 * October 2026: `upcoming`, the day in `dayWorked`), is approved as a day off: cash instead waits for the day.
 */
export function CompensatoryDecisionForm({
  action,
  stage,
  name,
  confidential = false,
  noCheckIn = false,
  cashDays,
  dayOff = null,
  hoursOff = null,
  upcoming = false,
  dayWorked = null,
}: {
  action: Action;
  stage: LeaveStage;
  name: string;
  confidential?: boolean;
  noCheckIn?: boolean;
  /** The day worked is still to come (asked ahead): no cash instead yet. */
  upcoming?: boolean;
  dayWorked?: string | null;
  /** The Setup's cash rate: a whole day's days' pay, and the rate of the hours' pay. */
  cashDays: number;
  dayOff?: string | null;
  /** The hours off a part of a day earned; null: a whole day. */
  hoursOff?: number | null;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [decision, setDecision] = useState<LeaveDecision | ''>(() => {
    const kept = valueOf(state, 'decision');
    return (LEAVE_DECISIONS as readonly string[]).includes(kept) ? (kept as LeaveDecision) : '';
  });
  const [outcome, setOutcome] = useState<CompensatoryOutcome>(() => (valueOf(state, 'outcome') === 'cash' && !upcoming ? 'cash' : 'day_off'));
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  const [confirmed, setConfirmed] = useState(false);
  const needsComment = decision !== '' && leaveDecisionNeedsComment(decision);
  const hrApproves = stage === 'hr' && decision === 'approve';
  const ready = decision !== '' && (!needsComment || comment.trim() !== '') && (!hrApproves || !noCheckIn || confirmed);
  const button = compensatoryDecisionButton(decision, stage, outcome, confidential, hoursOff !== null);
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
              <label key={o} className={`${choice} ${o === 'cash' && upcoming ? 'cursor-not-allowed opacity-60' : ''}`}>
                <input
                  type="radio"
                  name="outcome"
                  value={o}
                  checked={outcome === o}
                  disabled={o === 'cash' && upcoming}
                  onChange={() => setOutcome(o)}
                  className="size-4 accent-accent"
                />
                {o === 'cash' ? 'Cash instead' : hoursOff !== null ? 'Hours off' : 'A day off'}
              </label>
            ))}
          </div>
          <p className="hint">{compensatoryOutcomeHint(outcome, { dayOff, hoursOff }, cashDays)}</p>
          {upcoming && dayWorked && <p className="hint">{compensatoryCashWaitsText(dayWorked)}</p>}
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

/** A number of the Setup, with its label and hint. */
function SetupNumber({
  fid,
  name,
  label,
  hint,
  value,
  step,
  min,
  max,
  disabled,
  onChange,
}: {
  fid: (name: string) => string;
  name: keyof TypedCompensatorySetup;
  label: string;
  hint: React.ReactNode;
  value: string;
  step: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={fid(name)} className="label">
        {label}
      </label>
      <input
        id={fid(name)}
        name={name}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        required
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={fid(`${name}-hint`)}
        className="input"
      />
      <p id={fid(`${name}-hint`)} className="hint">
        {hint}
      </p>
    </div>
  );
}

/**
 * The Compensatory Setup (owner, 27 October 2026: "i need a setup dashboard for the compensatory leaves"; he chose all
 * four: "Minimum hours to qualify", "Hours for a full day", "Cash rate" (from the Leave Setup), "When the day off is
 * taken"; and the most hours off: "up to 4 hours to be compensated by hours - minimum 6 hours can be compensated by a
 * day", between them "Capped at 4 hours"): the five numbers, HR's to change (the others read them, the fields off), and
 * what they give with the numbers typed, row by row.
 */
export function CompensatorySetupForm({ action, settings, canEdit }: { action: Action; settings: CompensatoryRules; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTyped] = useState<TypedCompensatorySetup>(() => typedSetupOf(settings));
  const read = readCompensatorySetup(typed);
  const rows = compensatorySetupRows(read.rules ?? settings);
  const set = (key: keyof TypedCompensatorySetup) => (value: string) => setTyped((t) => ({ ...t, [key]: value }));
  const off = !canEdit;
  return (
    <form action={formAction} aria-label="Compensatory Setup" className="space-y-6">
      <FormErrors errors={state.errors} />
      {state.message && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {state.message}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <SetupNumber
          fid={fid}
          name="minHours"
          label="Minimum hours to qualify"
          hint="Fewer hours worked on a rest day or an official holiday earn nothing. Whole or half hours."
          value={typed.minHours}
          step={0.5}
          min={0.5}
          max={24}
          disabled={off}
          onChange={set('minHours')}
        />
        <SetupNumber
          fid={fid}
          name="hoursCap"
          label="Most hours off"
          hint="Part of a day earns the same hours off, at most these: more hours, still under a whole day, are capped at them."
          value={typed.hoursCap}
          step={0.5}
          min={0.5}
          max={24}
          disabled={off}
          onChange={set('hoursCap')}
        />
        <SetupNumber
          fid={fid}
          name="fullDayHours"
          label="Hours for a whole day"
          hint="From these hours worked, a whole day off, as for the whole day worked."
          value={typed.fullDayHours}
          step={0.5}
          min={0.5}
          max={24}
          disabled={off}
          onChange={set('fullDayHours')}
        />
        <SetupNumber
          fid={fid}
          name="cashRate"
          label="Cash instead: days' pay for a whole day"
          hint={`When HR approves cash instead of a day off, rarely: whole or half days. Hours are paid their share of it. ${COMPENSATORY_CASH_HINT}`}
          value={typed.cashRate}
          step={0.5}
          min={0.5}
          max={5}
          disabled={off}
          onChange={set('cashRate')}
        />
      </div>
      <fieldset>
        <legend className="label">When the day off is taken</legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <label className={choice}>
            <input type="radio" name="window" value="month" checked={typed.window === 'month'} disabled={off} onChange={() => set('window')('month')} className="size-4 accent-accent" />
            Same calendar month
          </label>
          <label className={choice}>
            <input type="radio" name="window" value="days" checked={typed.window === 'days'} disabled={off} onChange={() => set('window')('days')} className="size-4 accent-accent" />
            Within
            <input
              name="offWithinDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={COMPENSATORY_OFF_WITHIN_MAX}
              step={1}
              required={typed.window === 'days'}
              disabled={off || typed.window !== 'days'}
              value={typed.offWithinDays}
              onChange={(e) => set('offWithinDays')(e.target.value)}
              aria-label="Days after the day worked"
              className="input min-h-9 w-20 py-1"
            />
            days after the day worked
          </label>
        </div>
        <p className="hint">
          The day off, or the day for the hours off, is a working day: in the same month, before or after the day worked; or after it, within these days
          (1 to {COMPENSATORY_OFF_WITHIN_MAX}), across months too.
        </p>
      </fieldset>
      <section aria-labelledby={fid('rows')} className="space-y-2">
        <h3 id={fid('rows')} className="font-semibold">
          What It Gives
        </h3>
        {canEdit && read.errors.length > 0 ? (
          <div role="status" className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
            <p className="font-medium">Before you can save it:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
              {read.errors.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="table">
            <caption className="sr-only">What hours worked on a rest day or an official holiday give, with {read.rules ? 'the numbers above' : 'the numbers saved'}</caption>
            <thead>
              <tr>
                <th scope="col">Hours worked</th>
                <th scope="col">Earns</th>
                <th scope="col">For example</th>
                <th scope="col">Or cash instead</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.worked}>
                  <th scope="row" className="font-medium whitespace-nowrap">
                    {r.worked}
                  </th>
                  <td>{r.earns}</td>
                  <td className="whitespace-nowrap tabular-nums">{r.example}</td>
                  <td className="tabular-nums">{r.cash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          {read.rules ? 'With the numbers above' : 'With the numbers saved'}; cash for hours on a shift of 8 hours a day: each employee&apos;s is by their own
          shift&apos;s hours. Requests already made keep what they earned.
        </p>
      </section>
      {canEdit && (
        <button type="submit" disabled={pending || read.errors.length > 0} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? 'Saving…' : 'Save the Compensatory Setup'}
        </button>
      )}
    </form>
  );
}
