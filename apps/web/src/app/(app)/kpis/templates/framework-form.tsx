'use client';

import { KPI_FRAMEWORK_LIMITS, kpiFrameworkMonthProblems, type KpiDepartmentPillarsView, type KpiFrameworkView } from '@trendlix/shared';
import { startTransition, useActionState, useRef, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import {
  addPillar,
  appliesFromHint,
  followCompanyConfirmText,
  frameworkConfirmText,
  frameworkFormOf,
  frameworkInputOf,
  frameworkProblems,
  monthChoices,
  movePillar,
  removePillar,
  shortPlaceholder,
  updatePillar,
  weightTotal,
  type FrameworkForm,
} from './framework';

// Changing the KPI pillars (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", "Fully flexible"):
// HR's and the Super Admin's. The pillars in order, each with its name, short name (its name's first word when left
// empty) and weight; added (up to 8), removed (down to 1) and moved; the weights' total shown as typed; the pillar the
// Attendance metric counts in; the month they apply from (next month unless chosen, this month at the earliest). What
// stops them being saved shows as it is typed, as the API checks it (packages/shared kpi-framework.ts); Save asks first,
// saying when they apply and that every template must then place its metrics in them. The next pillars, once saved, are
// changed the same way until they apply.
// A department's own pillars (owner, 22 October 2026: "but i need pillars to each department"): the same form on the
// department's page, starting from its own pillars, or from the company's newest when it takes those; and going back
// to the company's pillars from a month (FollowCompanyForm).

const small =
  'inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
const smallDanger =
  'inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/** A department whose own pillars the form changes: its id, its name as headings show it, and its row of the view. */
export interface PillarsDepartment {
  id: string;
  name: string;
  row: KpiDepartmentPillarsView;
}

export function KpiFrameworkForm({
  view,
  action,
  today,
  department = null,
}: {
  view: KpiFrameworkView;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  today: string;
  /** A department's own pillars; none: the company's. */
  department?: PillarsDepartment | null;
}) {
  const fid = useFieldIds();
  const [form, setForm] = useState<FrameworkForm>(() => frameworkFormOf(view, department?.row ?? null));
  const [state, dispatch, pending] = useActionState(action, {});
  const counter = useRef(0);
  const problems = frameworkProblems(form, view.usedKeys, today);
  const total = weightTotal(form);
  // the next change of the scope, which a save changes (or replaces: a department going back to the company's)
  const next = department ? department.row.next : view.next;
  const changingNext = next !== null && !next.followsCompany;
  const L = KPI_FRAMEWORK_LIMITS;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || problems.length) return;
    if (!window.confirm(frameworkConfirmText(form.appliesFrom, changingNext, department?.name ?? null))) return;
    const fd = new FormData();
    // the next pillars as the page has them now (none: null), so a change made meanwhile isn't overwritten
    fd.set(
      'framework',
      JSON.stringify({
        ...frameworkInputOf(form, view.usedKeys),
        nextId: next?.id ?? null,
        ...(department && { departmentId: department.id, departmentName: department.name }),
      }),
    );
    startTransition(() => dispatch(fd));
  }

  const heading = department
    ? changingNext
      ? `Change ${department.name}’s Next Pillars`
      : `Set ${department.name}’s Own Pillars`
    : changingNext
      ? 'Change the Next Pillars'
      : 'Change the Pillars';

  return (
    <form noValidate onSubmit={submit} aria-labelledby={fid('heading')} className="space-y-5">
      <div>
        <h3 id={fid('heading')} className="font-semibold">
          {heading}
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          From {L.pillarsMin} to {L.pillarsMax} pillars, each with a different name; their weights are whole percents adding up to 100%. Renaming a pillar keeps
          its metrics in it; a template whose pillar is removed has those metrics to place again.
        </p>
      </div>
      <FormErrors errors={state.errors} />
      <ol className="space-y-3">
        {form.pillars.map((p, i) => (
          <li key={p.rowKey} className="rounded-lg border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Pillar {i + 1}</span>
              <div className="flex flex-wrap gap-1">
                <button type="button" disabled={i === 0} onClick={() => setForm((f) => movePillar(f, p.rowKey, -1))} className={small}>
                  Move up<span className="sr-only"> pillar {i + 1}</span>
                </button>
                <button type="button" disabled={i === form.pillars.length - 1} onClick={() => setForm((f) => movePillar(f, p.rowKey, 1))} className={small}>
                  Move down<span className="sr-only"> pillar {i + 1}</span>
                </button>
                <button
                  type="button"
                  disabled={form.pillars.length <= L.pillarsMin}
                  onClick={() => {
                    if (p.name.trim() && !window.confirm(`Remove pillar ${i + 1} (${p.name.trim()})? Templates with metrics in it will have them to place again.`)) return;
                    setForm((f) => removePillar(f, p.rowKey));
                  }}
                  className={smallDanger}
                >
                  Remove<span className="sr-only"> pillar {i + 1}</span>
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_7rem]">
              <div>
                <label htmlFor={fid(`${p.rowKey}-name`)} className="label">
                  Name
                </label>
                <input
                  id={fid(`${p.rowKey}-name`)}
                  value={p.name}
                  maxLength={L.name}
                  autoComplete="off"
                  placeholder="e.g. Delivery & Timeliness"
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => updatePillar(f, p.rowKey, { name }));
                  }}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor={fid(`${p.rowKey}-short`)} className="label">
                  Short name <span className="font-normal text-muted">(optional)</span>
                </label>
                <input
                  id={fid(`${p.rowKey}-short`)}
                  value={p.short}
                  maxLength={L.short}
                  autoComplete="off"
                  placeholder={shortPlaceholder(p.name)}
                  onChange={(e) => {
                    const short = e.target.value;
                    setForm((f) => updatePillar(f, p.rowKey, { short }));
                  }}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor={fid(`${p.rowKey}-weight`)} className="label">
                  Weight
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={fid(`${p.rowKey}-weight`)}
                    value={p.weight}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={3}
                    onChange={(e) => {
                      const weight = e.target.value;
                      setForm((f) => updatePillar(f, p.rowKey, { weight }));
                    }}
                    className="input w-20 tabular-nums"
                  />
                  <span className="text-sm text-muted">%</span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          disabled={form.pillars.length >= L.pillarsMax}
          onClick={() => {
            counter.current += 1;
            const rowKey = `n${counter.current}`;
            setForm((f) => addPillar(f, rowKey));
          }}
          className="btn btn-secondary"
        >
          Add a pillar
        </button>
        <p role="status" aria-live="polite" className={`text-sm font-semibold tabular-nums ${total === 100 ? 'text-ok' : 'text-warn'}`}>
          Total {total}%{total === 100 ? '' : ': the weights must add up to 100%'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('attendance')} className="label">
            Attendance counts in
          </label>
          <Select
            id={fid('attendance')}
            value={form.attendance}
            onChange={(e) => {
              const attendance = e.target.value;
              setForm((f) => ({ ...f, attendance }));
            }}
            aria-describedby={fid('attendance-hint')}
            className="input"
          >
            {!form.pillars.some((p) => p.rowKey === form.attendance) && <option value="">Choose a pillar</option>}
            {form.pillars.map((p, i) => (
              <option key={p.rowKey} value={p.rowKey}>
                {p.name.trim() || `Pillar ${i + 1}`}
              </option>
            ))}
          </Select>
          <p id={fid('attendance-hint')} className="hint">
            {department ? 'The pillar of the automatic Attendance metric, on every template of its job titles.' : 'The pillar of the automatic Attendance metric, on every template.'}
          </p>
        </div>
        <div>
          <label htmlFor={fid('appliesFrom')} className="label">
            Applies from
          </label>
          <Select
            id={fid('appliesFrom')}
            value={form.appliesFrom}
            onChange={(e) => {
              const appliesFrom = e.target.value;
              setForm((f) => ({ ...f, appliesFrom }));
            }}
            aria-describedby={fid('appliesFrom-hint')}
            className="input"
          >
            {monthChoices(view.earliestMonth, view.latestMonth).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
                {m.value === view.defaultMonth ? ' (next month)' : ''}
              </option>
            ))}
          </Select>
          <p id={fid('appliesFrom-hint')} className="hint">
            {appliesFromHint(form.appliesFrom)} The scorecards open already keep their pillars.
          </p>
        </div>
      </div>
      {problems.length > 0 && (
        <ul className="list-disc space-y-1 rounded-lg bg-warn-soft py-3 pr-4 pl-8 text-sm text-warn">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
        <button type="submit" disabled={pending || problems.length > 0} className="btn btn-primary">
          {pending ? 'Saving…' : changingNext ? 'Save the next pillars' : department ? 'Save its own pillars' : 'Save the new pillars'}
        </button>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * A department back to the company's pillars from a month (owner, 22 October 2026: "i need pillars to each
 * department"): its own stop applying then, its job titles taking the company's; a change coming is replaced. Asks
 * first.
 */
export function FollowCompanyForm({
  view,
  department,
  action,
  today,
}: {
  view: Pick<KpiFrameworkView, 'defaultMonth' | 'earliestMonth' | 'latestMonth'>;
  department: PillarsDepartment;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  today: string;
}) {
  const fid = useFieldIds();
  const next = department.row.next;
  const [appliesFrom, setAppliesFrom] = useState(() => (next?.followsCompany ? next.appliesFrom : view.defaultMonth));
  const [state, dispatch, pending] = useActionState(action, {});
  const problems = kpiFrameworkMonthProblems(appliesFrom, today);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || problems.length) return;
    if (!window.confirm(followCompanyConfirmText(department.name, appliesFrom))) return;
    const fd = new FormData();
    fd.set(
      'framework',
      JSON.stringify({ departmentId: department.id, departmentName: department.name, followsCompany: true, appliesFrom, attendancePillar: '', pillars: [], nextId: next?.id ?? null }),
    );
    startTransition(() => dispatch(fd));
  }

  return (
    <form noValidate onSubmit={submit} aria-labelledby={fid('heading')} className="space-y-4">
      <div>
        <h3 id={fid('heading')} className="font-semibold">
          {next?.followsCompany ? 'Change When It Goes Back to the Company’s Pillars' : 'Go Back to the Company’s Pillars'}
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          From the month chosen, {department.name}’s job titles take the company’s pillars again, and its own stop applying.
          {next && !next.followsCompany ? ' The change coming is replaced.' : ''}
        </p>
      </div>
      <FormErrors errors={state.errors} />
      <div className="max-w-sm">
        <label htmlFor={fid('appliesFrom')} className="label">
          From
        </label>
        <Select
          id={fid('appliesFrom')}
          value={appliesFrom}
          onChange={(e) => setAppliesFrom(e.target.value)}
          aria-describedby={fid('appliesFrom-hint')}
          className="input"
        >
          {monthChoices(view.earliestMonth, view.latestMonth).map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
              {m.value === view.defaultMonth ? ' (next month)' : ''}
            </option>
          ))}
        </Select>
        <p id={fid('appliesFrom-hint')} className="hint">
          {appliesFromHint(appliesFrom)} The scorecards open already keep their pillars.
        </p>
      </div>
      {problems.length > 0 && (
        <ul className="list-disc space-y-1 rounded-lg bg-warn-soft py-3 pr-4 pl-8 text-sm text-warn">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || problems.length > 0} className="btn btn-secondary">
          {pending ? 'Saving…' : next?.followsCompany ? 'Save the month' : 'Use the company’s pillars'}
        </button>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
