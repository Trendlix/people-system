'use client';

import type { SessionMode } from '@trendlix/shared';
import { useId, useState, useTransition } from 'react';
import { switchMode } from '@/lib/session-mode-actions';

/**
 * The top bar's switch for a developer who is also an employee (owner, 22 October 2026: "give hin a switched to use the
 * account as the main role assigned to him or as a developer, to not confuse him"): the mode in use ("Using as:
 * Developer"), and one click turns to the other and opens its home page. The API keeps it on the session and audits it.
 */
export function ModeSwitch({ text, to, hint }: { text: string; to: SessionMode; hint: string }) {
  const hintId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function flip() {
    setError(null);
    startTransition(async () => {
      // on success the home page opens, as the other mode shows it
      const r = await switchMode(to);
      if (r?.error) setError(r.error);
    });
  }

  return (
    <div className="flex min-w-0 flex-col items-end">
      <button type="button" onClick={flip} disabled={pending} aria-describedby={hintId} title={hint} className="btn btn-secondary whitespace-nowrap">
        {pending ? 'Switching…' : text}
        <span aria-hidden="true">▾</span>
      </button>
      <span id={hintId} className="sr-only">
        {hint}
      </span>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
