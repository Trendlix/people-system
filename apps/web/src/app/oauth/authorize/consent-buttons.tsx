'use client';

import { useActionState } from 'react';
import { allowClaude, denyClaude, type ConsentState } from './actions';

// Allow and Deny on the consent page (owner, 21 October 2026: "the connection method"), or Back to Claude alone when
// Allow can't be offered. Each sends the request on, as the page read it; a refusal is said under them.

export function ConsentButtons({ request, allow }: { request: string; allow: boolean }) {
  const [allowed, allowAction, allowing] = useActionState<ConsentState, FormData>(allowClaude, {});
  const [denied, denyAction, denying] = useActionState<ConsentState, FormData>(denyClaude, {});
  const busy = allowing || denying;
  const error = allowed.error ?? denied.error;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {allow && (
          <form action={allowAction}>
            <input type="hidden" name="request" value={request} />
            <button type="submit" disabled={busy} className="btn btn-primary">
              {allowing ? 'Connecting…' : 'Allow'}
            </button>
          </form>
        )}
        <form action={denyAction}>
          <input type="hidden" name="request" value={request} />
          <button type="submit" disabled={busy} className="btn btn-secondary">
            {denying ? 'Going back…' : allow ? 'Deny' : 'Back to Claude'}
          </button>
        </form>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
