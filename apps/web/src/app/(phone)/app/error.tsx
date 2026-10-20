'use client';

// The phone pages' error (owner, 20 October 2026: the employee app), as the site's (app/(app)/error.tsx): Next.js hides
// server error details in production, so a plain message instead of error.message; `retry` reads the page again.
export default function PhoneError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="card p-5">
      <h1 className="text-lg font-semibold">This Page Could Not Be Loaded</h1>
      <p className="mt-2 text-sm text-muted">The server may be busy or unreachable for a moment. Please try again. If it keeps happening, contact HR.</p>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <button type="button" onClick={() => retry()} className="btn btn-secondary mt-4 min-h-12 w-full">
        Try again
      </button>
    </div>
  );
}
