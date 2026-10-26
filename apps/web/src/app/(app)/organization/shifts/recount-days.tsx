'use client';

import { useState, useTransition } from 'react';
import { FormErrors } from '@/components/form';
import { Select } from '@/components/select';
import { monthLabel, monthsAfter, previewText, recountMonths, recountRangeProblem, resultText, skippedText, type RecountView } from '@/lib/recount';
import type { Shift } from '@/lib/types';
import { previewRecount, runRecount, type RecountState } from './recount-actions';

// Recount past days (owner, 26 October 2026, after changing the MORNING shift: "i want to recount previous payrolls on the
// new shift run"; asked earlier, "Months not yet paid"): From and To months (at most 12), one shift or everyone, a preview,
// then Recount. Every kept day with times in a month whose payroll isn't with the CEO, approved or paid is counted again
// on the person's shift as it is now (the system's days from their presses, Zoho People's from their pairs or first and
// last); the draft payrolls refill. Check-in and check-out times never change.

export function RecountDays({ shifts, thisMonth }: { shifts: Shift[]; thisMonth: string }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(monthsAfter(thisMonth, -2));
  const [to, setTo] = useState(thisMonth);
  const [shiftId, setShiftId] = useState('');
  const [errors, setErrors] = useState<string[] | undefined>();
  const [preview, setPreview] = useState<RecountView | null>(null);
  const [result, setResult] = useState<RecountView | null>(null);
  const [pending, start] = useTransition();
  const months = recountMonths(thisMonth);
  const problem = recountRangeProblem(from, to, thisMonth);

  function apply(state: RecountState) {
    setErrors(state.errors);
    if (state.preview) {
      setPreview(state.preview);
      setResult(null);
    }
    if (state.result) {
      setResult(state.result);
      setPreview(null);
    }
  }
  const changed = () => {
    setPreview(null);
    setResult(null);
    setErrors(undefined);
  };

  return (
    <section className="card mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Recount Past Days</h2>
          <p className="text-sm text-muted">Count the days of past months again on each person’s shift as it is now, after changing a shift.</p>
        </div>
        {!open && (
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            Recount past days
          </button>
        )}
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          <FormErrors errors={errors} />
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="recount-from" className="label">
                From
              </label>
              <Select id="recount-from" className="input" value={from} onChange={(e) => (setFrom(e.target.value), changed())}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="recount-to" className="label">
                To
              </label>
              <Select id="recount-to" className="input" value={to} onChange={(e) => (setTo(e.target.value), changed())}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="recount-shift" className="label">
                Shift
              </label>
              <Select id="recount-shift" className="input" value={shiftId} onChange={(e) => (setShiftId(e.target.value), changed())}>
                <option value="">Everyone</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    Shift {s.code}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {problem && <p className="text-sm text-danger">{problem}</p>}
          <p className="text-sm text-muted">
            Months whose payroll is with the CEO, approved or paid are left as they are. Send the payroll back to draft to recount it. The check-in and check-out times never change.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn" disabled={pending || !!problem} onClick={() => start(async () => apply(await previewRecount(from, to, shiftId)))}>
              {pending && !preview ? 'Counting…' : 'Preview'}
            </button>
            <button type="button" className="btn btn-primary" disabled={pending || !!problem || !preview} onClick={() => start(async () => apply(await runRecount(from, to, shiftId)))}>
              {pending && preview ? 'Recounting…' : 'Recount'}
            </button>
            <button type="button" className="btn" onClick={() => (setOpen(false), changed())}>
              Close
            </button>
          </div>
          {preview && (
            <p role="status" className="rounded-lg bg-canvas px-4 py-3 text-sm">
              {previewText(preview)}
            </p>
          )}
          {result && (
            <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
              {resultText(result)}
              {result.skipped.length > 0 && <span className="block text-muted">Send the payroll back to draft to recount {result.skipped.length === 1 ? 'it' : 'them'}: {skippedText(result.skipped)}.</span>}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
