'use client';

import { EMPLOYEE_BULK_MESSAGE_LIMITS, employeeBulkSummary } from '@trendlix/shared';
import { useEffect, useState, useTransition } from 'react';
import { FormErrors } from '@/components/form';
import { Select } from '@/components/select';
import { BULK_ACTION_GROUPS, BULK_ACTION_LABELS, employeesExportHref, selectedText, type BulkAction } from '@/lib/employee-bulk';
import { exemptChosen, inviteChosen, runBulk, type BulkOutcome } from './bulk-actions';

// The Employees list's bulk actions (owner, 1 November 2026: "i want to select and create bulk actions such as hold
// access, what else?"): the rows' boxes belong to this bar's form by its id; once one is ticked the bar shows at the
// foot of the list with the action, what it needs and Apply. Each person's is done as their own page's, and the answer
// says for how many it was done and who was skipped with why.

export const BULK_FORM_ID = 'employee-bulk';

const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM_ID}"][name="employeeIds"]`)];
const tickedIds = () => boxes().filter((b) => b.checked).map((b) => b.value);

/** Tells the bar the boxes changed (a click on a box does by itself). */
const changed = () => document.dispatchEvent(new Event('employee-bulk-change'));

/** The table head's box: all the rows shown, or none. */
export function SelectAllBox() {
  const [all, setAll] = useState(false);
  useEffect(() => {
    const read = () => {
      const b = boxes();
      setAll(b.length > 0 && b.every((x) => x.checked));
    };
    document.addEventListener('employee-bulk-change', read);
    document.addEventListener('change', read);
    return () => {
      document.removeEventListener('employee-bulk-change', read);
      document.removeEventListener('change', read);
    };
  }, []);
  return (
    <input
      type="checkbox"
      checked={all}
      onChange={(e) => {
        for (const b of boxes()) b.checked = e.target.checked;
        changed();
      }}
      aria-label="Select everyone shown"
      className="size-4 accent-accent"
    />
  );
}

/** A row's box. */
export function RowBox({ id, name }: { id: string; name: string }) {
  return <input type="checkbox" form={BULK_FORM_ID} name="employeeIds" value={id} aria-label={`Select ${name}`} onChange={changed} className="size-4 accent-accent" />;
}

const CONFIRMS: Partial<Record<BulkAction, true>> = { hold: true, release: true, invite: true, manager: true, department: true, shift: true, check_in_anywhere: true, exempt: true };

export function BulkBar({
  actions,
  managers,
  departments,
  shifts,
}: {
  actions: readonly BulkAction[];
  managers: { id: string; name: string }[];
  departments: { id: string; label: string }[];
  shifts: { id: string; label: string }[];
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [action, setAction] = useState<BulkAction>(actions[0]);
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);

  useEffect(() => {
    const read = () => setIds(tickedIds());
    document.addEventListener('employee-bulk-change', read);
    document.addEventListener('change', read);
    read();
    return () => {
      document.removeEventListener('employee-bulk-change', read);
      document.removeEventListener('change', read);
    };
  }, []);

  function clear() {
    for (const b of boxes()) b.checked = false;
    changed();
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ids.length) return;
    if (action === 'export') {
      window.location.href = employeesExportHref(ids);
      return;
    }
    const fd = new FormData(e.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? '').trim();
    if (CONFIRMS[action] && !window.confirm(`${BULK_ACTION_LABELS[action]} for ${ids.length} ${ids.length === 1 ? 'person' : 'people'}?`)) return;
    const chosen = [...ids];
    setOutcome(null);
    startTransition(async () => {
      const r =
        action === 'invite'
          ? await inviteChosen(chosen)
          : action === 'exempt'
            ? await exemptChosen({ employeeIds: chosen, reason: text('reason'), startDate: text('startDate') || null, endDate: text('endDate') || null })
            : await runBulk({
                action,
                employeeIds: chosen,
                ...(action === 'hold' && { reason: text('reason') }),
                ...(action === 'manager' && { managerId: text('managerId') || null }),
                ...(action === 'department' && { departmentId: text('departmentId') || null }),
                ...(action === 'shift' && { shiftId: text('shiftId') || null }),
                ...(action === 'check_in_anywhere' && { on: text('on') === 'on' }),
                ...(action === 'message' && { title: text('title'), body: text('body'), email: fd.get('email') === 'on' }),
              });
      setOutcome(r);
      if (!r.errors) clear();
    });
  }

  if (!ids.length && !outcome) return null;
  return (
    <form id={BULK_FORM_ID} onSubmit={submit} className="sticky bottom-0 z-10 space-y-3 border-t border-line bg-card px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
      {outcome?.errors && <FormErrors errors={outcome.errors} />}
      {outcome && !outcome.errors && (
        <div role="status" className="text-sm">
          <p className="font-semibold text-ok">{employeeBulkSummary(outcome.done ?? 0, outcome.skipped?.length ?? 0)}</p>
          {!!outcome.skipped?.length && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {outcome.skipped.map((s, i) => (
                <li key={i}>
                  {s.name}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {ids.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <p className="self-center text-sm font-semibold">{selectedText(ids.length)}</p>
          <div>
            <label htmlFor="bulk-action" className="label">
              Action
            </label>
            <Select id="bulk-action" value={action} onChange={(e) => setAction(e.target.value as BulkAction)} className="input min-w-56">
              {BULK_ACTION_GROUPS.map((g) => {
                const shown = g.actions.filter((a) => actions.includes(a));
                return shown.length ? (
                  <optgroup key={g.label} label={g.label}>
                    {shown.map((a) => (
                      <option key={a} value={a}>
                        {BULK_ACTION_LABELS[a]}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </Select>
          </div>

          {(action === 'hold' || action === 'exempt') && (
            <div className="min-w-56 flex-1">
              <label htmlFor="bulk-reason" className="label">
                Reason
              </label>
              <input id="bulk-reason" name="reason" required maxLength={500} className="input" />
            </div>
          )}
          {action === 'exempt' && (
            <>
              <div>
                <label htmlFor="bulk-start" className="label">
                  From
                </label>
                <input id="bulk-start" name="startDate" type="date" className="input" />
              </div>
              <div>
                <label htmlFor="bulk-end" className="label">
                  To
                </label>
                <input id="bulk-end" name="endDate" type="date" className="input" />
              </div>
            </>
          )}
          {action === 'manager' && (
            <div>
              <label htmlFor="bulk-manager" className="label">
                Manager
              </label>
              <Select id="bulk-manager" name="managerId" defaultValue="" className="input min-w-56">
                <option value="">No manager</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {action === 'department' && (
            <div>
              <label htmlFor="bulk-department" className="label">
                Department or team
              </label>
              <Select id="bulk-department" name="departmentId" required defaultValue="" className="input min-w-56">
                <option value="" disabled>
                  Choose…
                </option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {action === 'shift' && (
            <div>
              <label htmlFor="bulk-shift" className="label">
                Shift
              </label>
              <Select id="bulk-shift" name="shiftId" defaultValue="" className="input min-w-44">
                <option value="">No shift</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {action === 'check_in_anywhere' && (
            <div>
              <label htmlFor="bulk-on" className="label">
                Check in from anywhere
              </label>
              <Select id="bulk-on" name="on" defaultValue="on" className="input min-w-32">
                <option value="on">On</option>
                <option value="off">Off</option>
              </Select>
            </div>
          )}
          {action === 'message' && (
            <>
              <div className="min-w-56 flex-1">
                <label htmlFor="bulk-title" className="label">
                  Title
                </label>
                <input id="bulk-title" name="title" required maxLength={EMPLOYEE_BULK_MESSAGE_LIMITS.title} className="input" />
              </div>
              <div className="w-full">
                <label htmlFor="bulk-body" className="label">
                  Message
                </label>
                <textarea id="bulk-body" name="body" required maxLength={EMPLOYEE_BULK_MESSAGE_LIMITS.body} rows={3} dir="auto" className="input" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="email" defaultChecked className="size-4 accent-accent" />
                Email it too
              </label>
            </>
          )}

          <div className="ml-auto flex gap-2">
            <button type="button" onClick={clear} disabled={pending} className="btn btn-secondary">
              Clear
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? 'Working…' : action === 'export' ? 'Download' : 'Apply'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
