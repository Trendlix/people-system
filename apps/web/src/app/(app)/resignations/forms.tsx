'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { RESIGNATION_CONFIRMATION, RESIGNATION_LETTER_MAX_MB, RESIGNATION_REASON_MAX } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { formProblems, LETTER_ACCEPT, noticeHint } from './resignation';

// The forms of a resignation request (owner, 26 October 2026): the employee's, with the notice and the checks live; their
// Withdraw; and HR's Return with a reason. Each checks again on the API.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

/** The employee's request: the reason, a preferred last working day, a signed letter, and the confirmation. */
export function ResignForm({ action, today, notice, lastDayIfToday, toCeo, cancelHref }: { action: Action; today: string; notice: string | null; lastDayIfToday: string | null; toCeo: boolean; cancelHref: string }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const [typed, setTyped] = useState(() => ({ reason: valueOf(state, 'reason'), preferredLastDay: valueOf(state, 'preferredLastDay'), confirmed: valueOf(state, 'confirmed') === 'yes' }));
  const [letter, setLetter] = useState<{ name: string; size: number; type: string } | null>(null);
  const problems = formProblems(typed, letter, today);

  return (
    <form
      {...form}
      onChange={(e) => {
        const t = e.target;
        if (t instanceof HTMLInputElement && t.type === 'file') {
          const f = t.files?.[0];
          setLetter(f ? { name: f.name, size: f.size, type: f.type } : null);
        } else if (t instanceof HTMLInputElement && t.type === 'checkbox') setTyped((x) => ({ ...x, confirmed: t.checked }));
        else if ((t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && (t.name === 'reason' || t.name === 'preferredLastDay')) {
          setTyped((x) => ({ ...x, [t.name]: t.value }));
        }
      }}
      aria-label="Resign"
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('reason')} className="label">
          Reason
        </label>
        <textarea id={fid('reason')} name="reason" rows={3} required maxLength={RESIGNATION_REASON_MAX} defaultValue={typed.reason} aria-describedby={fid('reason-hint')} className="input" />
        <p id={fid('reason-hint')} className="hint">
          Short. {toCeo ? 'The CEO reads it.' : 'HR reads it.'} Up to {RESIGNATION_REASON_MAX} characters.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('preferredLastDay')} className="label">
            Preferred last working day {optional}
          </label>
          <DateInput id={fid('preferredLastDay')} name="preferredLastDay" defaultValue={typed.preferredLastDay} aria-describedby={fid('preferred-hint')} />
          <p id={fid('preferred-hint')} className="hint">
            {noticeHint(notice, lastDayIfToday, formatDate)}
          </p>
        </div>
        <div>
          <label htmlFor={fid('letter')} className="label">
            Signed letter {optional}
          </label>
          <input
            id={fid('letter')}
            name="letter"
            type="file"
            accept={LETTER_ACCEPT}
            aria-describedby={fid('letter-hint')}
            className="block w-full text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-card file:px-4 file:text-sm file:font-semibold"
          />
          <p id={fid('letter-hint')} className="hint">
            A PDF or a photo, up to {RESIGNATION_LETTER_MAX_MB} MB.
          </p>
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" name="confirmed" value="yes" defaultChecked={typed.confirmed} className="mt-0.5 size-4 accent-accent" />
        <span>{RESIGNATION_CONFIRMATION}</span>
      </label>
      {problems.length > 0 && (
        <div role="status" aria-live="polite" className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
          <p className="font-medium">Before you can send it:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending} pendingText="Sending…" disabled={problems.length > 0}>
          Send resignation request
        </SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** The employee's Withdraw, while it waits for HR. */
export function WithdrawButton({ action }: { action: () => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Withdrawing…' : 'Withdraw my request'}
      </button>
    </form>
  );
}

/** HR's Return: a mistaken request, with the reason the employee sees. */
export function ReturnForm({ action }: { action: Action }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} aria-label="Return the request" className="space-y-3">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('reason')} className="label">
          Why it is returned
        </label>
        <textarea id={fid('reason')} name="reason" rows={2} required maxLength={1000} defaultValue={valueOf(state, 'reason')} className="input" />
        <p className="hint">For a request sent by mistake. The employee is told and may send it again.</p>
      </div>
      <SubmitButton busy={pending} pendingText="Returning…">
        Return it
      </SubmitButton>
    </form>
  );
}
