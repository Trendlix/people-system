'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import { permissionClock, permissionHoursText, permissionMonth } from '@trendlix/shared';
import { DateInput, TimeInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { SurfaceField } from '@/components/surface';
import { formatDate, parseDate } from '@/lib/format';
import type { FormState, PermissionMonthView } from '@/lib/types';
import { monthName } from '../payroll/list';
import { weekdayOf } from '../organization/holidays/holidays';
import { permissionMonthData } from './permission-actions';
import {
  permissionFormProblems,
  permissionHourOptions,
  permissionMonthText,
  permissionReadyText,
  usedOnDay,
  workedOutTimes,
  type TypedPermission,
} from './permissions';
import { REASON_MAX } from './request';

// The permission form (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", asked how it is asked
// for, "In the system, like leave"): the employee's own request from My Requests, or HR's record on someone's behalf,
// approved at once. Above it what is left of the month's hours (approved, waiting, left of the Leave Setup's hours a
// month); the day, the hours in half hours up to the day's most, the times when given (with one of them the other follows
// from the hours, shown as chosen; the times chosen in lists, owner, 20 October 2026: "make AM and PM a selector"), and a
// reason. The shared checks show live, Send staying off while any is left; a day in another month reads that month's
// hours. What only the API knows (a rest day of the shift, an official holiday, a day of leave) it refuses when sent,
// and that shows here with what was typed.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

/** Who the permission is for: the employee themself, or someone HR records it for. */
export interface PermissionPerson {
  /** For HR recording on their behalf; null for the employee themself. */
  employeeId: string | null;
  name: string;
}

export function NewPermissionForm({
  action,
  person,
  initial,
  today,
  cancelHref,
  toCeo = false,
}: {
  action: Action;
  person: PermissionPerson;
  /** The month's hours of today's month (or of the day asked for): the figures above the form and the checks. */
  initial: PermissionMonthView;
  /** Today, YYYY-MM-DD (Cairo). */
  today: string;
  cancelHref: string;
  /** The employee is C-level (19 October 2026): after their manager it goes to the CEO, not HR. */
  toCeo?: boolean;
}) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const byHr = person.employeeId !== null;
  const [typed, setTyped] = useState<TypedPermission>(() => ({
    date: valueOf(state, 'date'),
    hours: valueOf(state, 'hours'),
    fromTime: valueOf(state, 'fromTime'),
    toTime: valueOf(state, 'toTime'),
    reason: valueOf(state, 'reason'),
  }));
  const [loaded, setLoaded] = useState<PermissionMonthView>(initial);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const asked = useRef(initial.month);

  const date = parseDate(typed.date) || null;
  const month = date ? permissionMonth(date) : loaded.month;
  const stale = month !== loaded.month;
  const problems = permissionFormProblems(typed, stale ? null : loaded, byHr ? person.name : null);
  if (checking || (stale && !loadProblem)) problems.push(`Checking the permission hours of ${monthName(month)}…`);
  const blocked = problems.length > 0 || sending;
  const options = permissionHourOptions(loaded.maxHoursPerDay);
  const times = workedOutTimes(typed);
  const dayUsed = date && !stale ? usedOnDay(loaded, date) : 0;

  /** The month's hours again, for the month of the day typed. */
  function readFor(wanted: string) {
    if (wanted === asked.current) return;
    asked.current = wanted;
    setLoadProblem(null);
    startChecking(async () => {
      const answer = await permissionMonthData(wanted, person.employeeId);
      if (asked.current !== wanted) return;
      if ('month' in answer) setLoaded(answer.month);
      else setLoadProblem(`The permission hours of ${monthName(wanted)} couldn't be checked: ${answer.errors.join(' ')} They are checked again when you send it.`);
    });
  }

  function set<K extends keyof TypedPermission>(key: K, value: TypedPermission[K]) {
    setTyped((t) => ({ ...t, [key]: value }));
    if (key === 'date') {
      const d = parseDate(value);
      if (d) readFor(permissionMonth(d));
    }
  }

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
        // the day and the times typed, for the checks (the fields stay uncontrolled)
        const t = e.target;
        if (t instanceof HTMLInputElement && (t.name === 'date' || t.name === 'fromTime' || t.name === 'toTime')) set(t.name as 'date' | 'fromTime' | 'toTime', t.value);
      }}
      aria-label={byHr ? `Record permission for ${person.name}` : 'New permission request'}
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      {person.employeeId && <input type="hidden" name="employeeId" value={person.employeeId} />}

      <div role="status" aria-live="polite" className="rounded-lg bg-canvas px-4 py-3 text-sm">
        <p className="font-semibold tabular-nums">{permissionMonthText(loaded, today.slice(0, 7))}</p>
        <p className="text-xs text-muted">
          {byHr ? `${person.name}'s permission` : 'Your permission'}: at most {permissionHoursText(loaded.maxHoursPerDay)} a day and{' '}
          {permissionHoursText(loaded.hoursPerMonth)} a month, as Leave Setup gives it.
          {date && dayUsed > 0 && ` ${permissionClock(dayUsed)} already asked for on ${weekdayOf(date)} ${formatDate(date)}.`}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('date')} className="label">
            Day
          </label>
          <DateInput id={fid('date')} name="date" required defaultValue={typed.date} aria-describedby={fid('date-hint')} />
          <p id={fid('date-hint')} className="hint">
            {byHr
              ? 'A working day of their shift, not an official holiday or a day of leave. It may be in the past.'
              : 'A working day of your shift, not an official holiday or a day of leave.'}
          </p>
        </div>
        <div>
          <label htmlFor={fid('hours')} className="label">
            Hours
          </label>
          <Select
            id={fid('hours')}
            name="hours"
            required
            value={typed.hours}
            onChange={(e) => set('hours', e.target.value)}
            aria-describedby={fid('hours-hint')}
            className="input"
          >
            <option value="">Choose the hours</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <p id={fid('hours-hint')} className="hint">
            In half hours, at most {permissionHoursText(loaded.maxHoursPerDay)} a day.
          </p>
        </div>
        <div>
          <label htmlFor={fid('fromTime')} className="label">
            From {optional}
          </label>
          <TimeInput id={fid('fromTime')} name="fromTime" defaultValue={typed.fromTime} aria-describedby={fid('times-hint')} />
        </div>
        <div>
          <label htmlFor={fid('toTime')} className="label">
            To {optional}
          </label>
          <TimeInput id={fid('toTime')} name="toTime" defaultValue={typed.toTime} aria-describedby={fid('times-hint')} />
        </div>
        <p id={fid('times-hint')} className="hint -mt-3 sm:col-span-2">
          Choose one: the other follows from the hours, e.g. leaving at 5:00 PM for 2 hours is from 5:00 PM.
          {times && ` As chosen: ${times}.`}
        </p>
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Reason {optional}
          </label>
          <textarea
            id={fid('reason')}
            name="reason"
            rows={2}
            maxLength={REASON_MAX}
            value={typed.reason}
            onChange={(e) => set('reason', e.target.value)}
            aria-describedby={fid('reason-hint')}
            className="input"
          />
          <p id={fid('reason-hint')} className="hint">
            {byHr ? 'E.g. a doctor’s appointment, reported by phone.' : 'Your direct manager and HR read it.'} Up to {REASON_MAX} characters.
          </p>
        </div>
      </div>

      {loadProblem && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{loadProblem}</p>}
      <div role="status" aria-live="polite">
        {problems.length ? (
          <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
            <p className="font-medium">Before you can {byHr ? 'record' : 'send'} it:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">{permissionReadyText(typed, byHr, person.name, toCeo)}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={blocked} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">
          {sending ? (byHr ? 'Recording…' : 'Sending…') : byHr ? 'Record permission' : 'Send request'}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary ${sending ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={sending || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
