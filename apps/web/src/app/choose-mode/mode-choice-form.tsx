'use client';

import type { SessionMode } from '@trendlix/shared';
import { useActionState } from 'react';
import { useFieldIds } from '@/components/form';
import { chooseMode, type ModeResult } from '@/lib/session-mode-actions';
import type { ModeCard } from '@/lib/session-mode';

/** The two cards (one choice, the last one pre-selected) and Continue, which opens the home page in that mode. */
export function ModeChoiceForm({ cards, selected }: { cards: ModeCard[]; selected: SessionMode }) {
  const [state, action, pending] = useActionState<ModeResult, FormData>(chooseMode, {});
  const fid = useFieldIds();
  return (
    <form action={action} className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="sr-only">Use the system</legend>
        {cards.map((card) => (
          <label
            key={card.mode}
            htmlFor={fid(card.mode)}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-card p-4 has-checked:border-accent has-checked:bg-accent-soft"
          >
            <input
              id={fid(card.mode)}
              type="radio"
              name="mode"
              value={card.mode}
              defaultChecked={card.mode === selected}
              aria-describedby={fid(`${card.mode}-text`)}
              className="mt-1 size-4 shrink-0 accent-accent"
            />
            <span className="min-w-0">
              <span className="block font-semibold">{card.title}</span>
              {card.who && (
                <span dir="auto" className="block text-sm font-medium break-words">
                  {card.who}
                </span>
              )}
              <span id={fid(`${card.mode}-text`)} className="mt-1 block text-sm text-muted">
                {card.text}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="hint">You can switch at any time from the top bar.</p>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? 'Opening…' : 'Continue'}
      </button>
    </form>
  );
}
