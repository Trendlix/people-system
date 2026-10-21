'use client';

import { useState, useTransition } from 'react';
import { discardDraft } from './actions';

// Discard on a draft from Claude (step 2, owner, 21 October 2026: "the connection method"), on Drafts from Claude and on
// the Add form filled in from it: asked once more, then set aside (never an asset; the audit log keeps it).

export function DiscardDraftButton({ id, name, back = null }: { id: string; name: string; back?: string | null }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function discard() {
    setError(null);
    start(async () => {
      const result = await discardDraft(id, back);
      if (result.errors?.length) setError(result.errors.join(' '));
      else setAsking(false);
    });
  }

  return (
    <div className="space-y-2">
      {asking ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Discard the draft of {name}?</span>
          <button type="button" onClick={discard} disabled={busy} className="btn btn-danger">
            {busy ? 'Discarding…' : 'Discard draft'}
          </button>
          <button type="button" onClick={() => setAsking(false)} disabled={busy} className="btn btn-secondary">
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className="btn btn-secondary">
          Discard
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
