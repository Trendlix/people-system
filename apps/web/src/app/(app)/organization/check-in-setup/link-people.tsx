'use client';

import { useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { linkButtonText, linkOptions, withChosen, type LinkCandidate } from './setup';

// "Link people" on a sub-location's card (owner, 20 October 2026: "main office location is the hero and other locations
// are like sub locations. shown with their name and linked users"; "own sublocation shows the sub location name"): opens
// a picker, the searchable drop-down list (type a name, a code or a department) of the current employees not linked yet;
// each one chosen becomes a chip (× takes it off again), and "Link 3 people" links them all. Linked people check in there
// as their own place: not flagged, and an Office person may check in there off the office network. The list holds only
// whom the caller may see (a C-level person only for the CEO and the Super Admin); the API checks again.

export function LinkPeople({
  action,
  candidates,
  linked,
  place,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  candidates: readonly LinkCandidate[];
  /** The people linked already: not offered. */
  linked: readonly string[];
  place: string;
}) {
  const fid = useFieldIds();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const { state, pending, form } = useKeptForm(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.message && !result.errors?.length) {
      setChosen([]);
      setOpen(false);
      setDone(result.message);
    }
    return result;
  });
  const options = linkOptions(candidates, [...linked, ...chosen]);
  const names = new Map(candidates.map((c) => [c.id, c.fullNameEn]));
  const left = linkOptions(candidates, linked).length;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setDone(null);
            setOpen(true);
          }}
          disabled={left === 0}
          aria-expanded="false"
          className="btn btn-secondary min-h-9 px-3"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
            <path d="M10 4v12M4 10h12" />
          </svg>
          Link people<span className="sr-only"> to {place}</span>
        </button>
        {left === 0 && <span className="text-xs text-muted">Everyone is linked already.</span>}
        {done && (
          <p role="status" className="text-sm text-ok">
            {done}
          </p>
        )}
      </div>
    );
  }

  return (
    <form {...form} className="space-y-3 rounded-lg border border-line bg-canvas p-3" aria-label={`Link people to ${place}`}>
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('person')} className="label">
          Person
        </label>
        <Select
          id={fid('person')}
          // opened by Link people: the list is where the keyboard goes next
          autoFocus
          value=""
          onChange={(e) => setChosen((c) => withChosen(c, e.target.value))}
          aria-describedby={fid('person-hint')}
          className="input"
        >
          <option value="">{options.length ? 'Choose a person…' : 'No one else to choose'}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <p id={fid('person-hint')} className="hint">
          Type a name, a code or a department to search. Choose several, then link them together.
        </p>
      </div>
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen to link">
          {chosen.map((id) => (
            <li key={id} className="inline-flex items-center gap-0.5 rounded-full border border-accent/40 bg-accent-soft py-0.5 ps-2.5 pe-0.5 text-xs font-medium text-accent">
              {names.get(id) ?? id}
              <input type="hidden" name="employeeId" value={id} />
              <button
                type="button"
                onClick={() => setChosen((c) => c.filter((x) => x !== id))}
                aria-label={`Take ${names.get(id) ?? 'this person'} off the list`}
                className="inline-flex size-6 items-center justify-center rounded-full hover:bg-card"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton busy={pending} disabled={!chosen.length} pendingText="Linking…">
          {chosen.length ? linkButtonText(chosen.length) : 'Link'}
        </SubmitButton>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setChosen([]);
          }}
          className="btn btn-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
