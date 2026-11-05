'use client';

import { useRef, useState, useTransition } from 'react';
import type { PayrollInputs } from '@trendlix/shared';
import { useFieldIds } from '@/components/form';
import type { FormState, PayrollLineView } from '@/lib/types';
import { CORRECTION_FIELDS, correctionHint, correctionOf, correctionStart, REASON_MAX } from './correction';
import { tidyCell, type InputField } from './grid';
import { closePopupOf, Popup } from './popup';

// Correct on a line of an approved or paid run (owner, 5 November 2026: "if there was a problem in the employee
// calculation and has been edited"; asked, "Payslip and register too"): a popup with the figures the draft's grid types,
// as the line has them, and why; checked here as the grid checks its cells, then sent (only those changed) and the page
// shown again with the line worked out anew. The API's refusal is shown in place.

/** Sends the correction (correctPayrollLine, bound to the run). */
export type Correct = (lineId: string, inputs: Partial<PayrollInputs>, reason: string) => Promise<FormState>;

export function CorrectLine({ line, correct }: { line: PayrollLineView; correct: Correct }) {
  return (
    <Popup
      label={
        <>
          Correct<span className="sr-only"> {line.name}&apos;s line</span>
        </>
      }
      title={`Correct ${line.name}'s line`}
      subtitle="The line is worked out again: the register, the payslip and what the bank batches still pay follow."
      buttonClassName="text-xs font-semibold text-accent hover:underline"
      wide
    >
      <CorrectForm line={line} correct={correct} />
    </Popup>
  );
}

function CorrectForm({ line, correct }: { line: PayrollLineView; correct: Correct }) {
  const fid = useFieldIds();
  const form = useRef<HTMLFormElement>(null);
  const [typed, setTyped] = useState<Record<InputField, string>>(() => correctionStart(line));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const c = correctionOf(line, typed, reason);
    if (!c.ok) return setErrors(c.errors);
    setErrors([]);
    startTransition(async () => {
      const answer = await correct(line.id, c.inputs, c.reason);
      if (answer.errors?.length) return setErrors(answer.errors);
      setReason('');
      closePopupOf(form.current);
    });
  };

  return (
    <form ref={form} onSubmit={send} className="space-y-4" noValidate>
      {errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 rounded-lg bg-danger-soft px-6 py-3 text-sm text-danger">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {CORRECTION_FIELDS.map((c) => {
          const hint = correctionHint(line, c);
          return (
            <div key={c.field}>
              <label htmlFor={fid(c.field)} className="label">
                {c.label}
              </label>
              <input
                id={fid(c.field)}
                value={typed[c.field]}
                inputMode="decimal"
                autoComplete="off"
                onChange={(e) => setTyped({ ...typed, [c.field]: e.target.value })}
                onBlur={() => setTyped({ ...typed, [c.field]: tidyCell(c.kind, typed[c.field]) })}
                aria-describedby={hint ? fid(`${c.field}-hint`) : undefined}
                className="input tabular-nums"
              />
              {hint && (
                <p id={fid(`${c.field}-hint`)} className="hint">
                  {hint}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <label htmlFor={fid('reason')} className="label">
          Why it is corrected
        </label>
        <textarea id={fid('reason')} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={REASON_MAX} required className="input" />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Correcting…' : 'Correct the line'}
        </button>
        <button type="button" disabled={pending} onClick={(e) => closePopupOf(e.currentTarget)} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
