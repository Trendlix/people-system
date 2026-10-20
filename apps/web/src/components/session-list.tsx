'use client';

import { SESSION_KIND_LABELS } from '@trendlix/shared';
import { useState, useTransition } from 'react';
import { deviceOf } from '@/lib/devices';
import { formatDateTime } from '@/lib/format';
import type { OpenSession } from '@/lib/types';

// The sessions still open (owner, 20 October 2026: one on the website and one in the app a user, kept on the server):
// where each was signed in (the website or the app, the browser and system it said), since when, its last activity, and
// a button to end it. Your Sessions (one's own: Sign out) and the Users page (an Admin's: End session) both list them.

export interface SessionListProps {
  sessions: OpenSession[];
  /** Ends the session; answers the API's refusal, if any. Left out: no button (e.g. an Admin on a Super Admin's account). */
  end?: (id: string) => Promise<{ error?: string }>;
  /** The button's words: "Sign out" on one's own list, "End session" on the Users page. */
  endLabel: string;
  /** The current session's own button, when it has one (Your Sessions: the menu's Sign out); else `end` as for the others. */
  currentAction?: React.ReactNode;
  empty: string;
}

export function SessionList({ sessions, end, endLabel, currentAction, empty }: SessionListProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (!sessions.length) return <p className="text-sm text-muted">{empty}</p>;

  function endOne(id: string) {
    if (!end) return;
    setError(null);
    setBusy(id);
    startTransition(async () => {
      const result = await end(id);
      setBusy(null);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line-soft">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {SESSION_KIND_LABELS[s.kind] ?? s.kind}
                <span className="font-normal text-muted">· {deviceOf(s.userAgent)}</span>
                {s.current && <span className="badge bg-ok-soft text-ok">This device</span>}
              </p>
              <p className="text-xs text-muted">
                Signed in {formatDateTime(s.createdAt)} · Last active {formatDateTime(s.lastActiveAt)}
              </p>
            </div>
            {s.current && currentAction
              ? currentAction
              : end && (
                  <button type="button" onClick={() => endOne(s.id)} disabled={busy !== null} className="btn btn-secondary">
                    {busy === s.id ? 'Ending…' : endLabel}
                  </button>
                )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
