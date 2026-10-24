'use client';

import type { MeetingChoices } from '@trendlix/shared';
import { useActionState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';

// An online interview still without its link (owner, 24 October 2026: "automatically generate meeting links"; the brief:
// "HR is told plainly ("Google refused: …") with Try again or Paste a link"): Try again with one of the scheduler's
// choices, or paste the link of a meeting made by hand. The candidate and the interviewers are told once it has one.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function Result({ state, pending }: { state: FormState; pending: boolean }) {
  if (!state.message || state.errors || pending) return null;
  return (
    <p role="status" className="text-sm text-ok">
      {state.message}
    </p>
  );
}

export function MeetingFix({ action, choices }: { action: Action; choices: MeetingChoices }) {
  const [retried, retry, retrying] = useActionState(action, {});
  const [pasted, paste, pasting] = useActionState(action, {});
  const fid = useFieldIds();
  const first = choices.choices.some((c) => c.key === choices.start) ? choices.start : choices.choices[0]?.key;
  return (
    <div className="space-y-3 rounded-lg border border-line p-4">
      {choices.choices.length > 0 && (
        <form action={retry} className="space-y-2">
          <FormErrors errors={retried.errors} />
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor={fid('meeting')} className="label">
                Create the meeting with
              </label>
              <Select id={fid('meeting')} name="meeting" defaultValue={first} className="input">
                {choices.choices.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <button type="submit" disabled={retrying || pasting} className="btn btn-primary">
              {retrying ? 'Trying…' : 'Try again'}
            </button>
          </div>
          <Result state={retried} pending={retrying} />
        </form>
      )}
      <form action={paste} className="space-y-2">
        <FormErrors errors={pasted.errors} />
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={fid('link')} className="label">
              Or paste a link
            </label>
            <input id={fid('link')} name="link" type="url" inputMode="url" placeholder="https://meet.google.com/…" maxLength={300} className="input" />
          </div>
          <button type="submit" disabled={retrying || pasting} className="btn btn-secondary">
            {pasting ? 'Saving…' : 'Use this link'}
          </button>
        </div>
        <Result state={pasted} pending={pasting} />
      </form>
    </div>
  );
}
