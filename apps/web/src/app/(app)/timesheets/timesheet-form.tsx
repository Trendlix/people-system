'use client';

import { TIMESHEET_LIMITS, timesheetHoursText, type MyTimesheetView } from '@trendlix/shared';
import { useMemo, useRef, useState, useTransition } from 'react';
import { FormErrors } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { saveMyTimesheet, sendMyTimesheet } from './actions';
import { blankLine, clientGroups, dayHead, entriesOf, lineTotals, linesOf, type TimesheetLine } from './timesheets';

// My Timesheet's form (owner, 4 November 2026: "Timesheet in app/website"): the week day by day, each day's lines (a
// client from the list, those they work on first, or a task written, the hours in quarter hours, a note), a line added
// to a day gone by or today, removed; Save keeps them, Send for approval saves and sends the week. What the form can
// see is said before anything is sent (packages/shared timesheetEntryProblems); the API checks it all again.

export function TimesheetForm({ view, today }: { view: MyTimesheetView; today: string }) {
  const [lines, setLines] = useState<TimesheetLine[]>(() => linesOf(view.entries));
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const next = useRef(0);
  const totals = useMemo(() => lineTotals(lines), [lines]);
  const groups = clientGroups(view.clients);
  const total = [...totals.values()].reduce((n, h) => n + h, 0);

  const change = (key: string, field: keyof TimesheetLine, value: string) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  const add = (date: string) => setLines((ls) => [...ls, blankLine(date, `new-${(next.current += 1)}`)]);
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  function go(send: boolean) {
    const { entries, errors } = entriesOf(lines, { weekStart: view.weekStart, today });
    if (errors.length) return setState({ errors });
    setState({});
    start(async () => setState(await (send ? sendMyTimesheet : saveMyTimesheet)(view.weekStart, entries)));
  }

  return (
    <div className="space-y-4">
      <FormErrors errors={state.errors} />
      {state.message && !state.errors && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {state.message}
        </p>
      )}
      {view.days.map((d) => {
        const dayLines = lines.filter((l) => l.date === d.date);
        const hours = totals.get(d.date) ?? 0;
        const comes = d.date > today;
        return (
          <section key={d.date} aria-labelledby={`day-${d.date}`} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`day-${d.date}`} className="font-semibold tabular-nums">
                {dayHead(d.date)}
              </h2>
              <span className="text-sm text-muted tabular-nums">{hours ? timesheetHoursText(hours) : comes ? 'Not yet' : 'No hours'}</span>
            </div>
            {dayLines.map((l) => (
              <div key={l.key} className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_6rem_minmax(0,1fr)_auto] sm:items-end">
                <label className="block text-sm">
                  <span className="label">Client</span>
                  <Select value={l.clientAccountId} onChange={(e) => change(l.key, 'clientAccountId', e.target.value)} className="input">
                    <option value="">No client</option>
                    {groups.assigned.length > 0 && (
                      <optgroup label="Your clients">
                        {groups.assigned.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {groups.others.length > 0 && (
                      <optgroup label={groups.assigned.length ? 'Other clients' : 'Clients'}>
                        {groups.others.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </label>
                <label className="block text-sm">
                  <span className="label">Task</span>
                  <input value={l.task} onChange={(e) => change(l.key, 'task', e.target.value)} maxLength={TIMESHEET_LIMITS.task} placeholder="E.g. Editing" className="input" />
                </label>
                <label className="block text-sm">
                  <span className="label">Hours</span>
                  <input value={l.hours} onChange={(e) => change(l.key, 'hours', e.target.value)} inputMode="decimal" placeholder="1.5" className="input tabular-nums" />
                </label>
                <label className="block text-sm">
                  <span className="label">
                    Note <span className="font-normal text-muted">(optional)</span>
                  </span>
                  <input value={l.note} onChange={(e) => change(l.key, 'note', e.target.value)} maxLength={TIMESHEET_LIMITS.note} className="input" />
                </label>
                <button type="button" onClick={() => remove(l.key)} className="btn btn-secondary min-h-11" aria-label={`Remove this line of ${dayHead(d.date)}`}>
                  Remove
                </button>
              </div>
            ))}
            {!comes && (
              <button type="button" onClick={() => add(d.date)} className="btn btn-secondary min-h-9 px-3">
                Add a line
              </button>
            )}
          </section>
        );
      })}
      <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3 shadow-lg">
        <p className="mr-auto px-1 text-sm font-semibold tabular-nums">Week total: {timesheetHoursText(Math.round(total * 100) / 100)}</p>
        <button type="button" onClick={() => go(false)} disabled={pending} className="btn btn-secondary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => go(true)} disabled={pending || !lines.length} className="btn btn-primary">
          {pending ? 'Sending…' : 'Send for approval'}
        </button>
      </div>
    </div>
  );
}
