'use client';

import type { InterviewDefaults } from '@trendlix/shared';
import { FormErrors, useFieldIds, useKeptForm } from '@/components/form';
import { Select } from '@/components/select';
import { defaultChoices } from '@/lib/interview-hours';
import type { FormState } from '@/lib/types';

// The company's interview defaults (owner, 25 October 2026: "Hours + calendar"; the brief: "a minimum notice (default 24
// hours) and a buffer between interviews (default 15 minutes) as company defaults … which a person may only make
// stricter"): the least notice an interview is booked with, and the time kept free around each of a person's interviews.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function InterviewDefaultsForm({ defaults, action }: { defaults: InterviewDefaults; action: Action }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const choices = defaultChoices(defaults);
  return (
    <form {...form} className="space-y-3">
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('noticeHours')} className="label">
            Minimum notice
          </label>
          <Select id={fid('noticeHours')} name="noticeHours" defaultValue={String(defaults.noticeHours)} aria-describedby={fid('notice-hint')} className="input">
            {choices.notice.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <p id={fid('notice-hint')} className="hint">
            “Find a time” offers no time sooner than this.
          </p>
        </div>
        <div>
          <label htmlFor={fid('bufferMinutes')} className="label">
            Buffer between interviews
          </label>
          <Select id={fid('bufferMinutes')} name="bufferMinutes" defaultValue={String(defaults.bufferMinutes)} aria-describedby={fid('buffer-hint')} className="input">
            {choices.buffer.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <p id={fid('buffer-hint')} className="hint">
            Kept free before and after each of a person’s interviews.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state.message && !state.errors && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
