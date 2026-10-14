'use client';

// Next.js hides server error details in production, so show a plain message instead of error.message.
// `retry` re-fetches the page's data and renders it again.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="card max-w-xl p-6">
      <h1 className="text-lg font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-muted">
        The server may be busy or unreachable for a moment. Please try again. If it keeps happening, contact your administrator.
      </p>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <button type="button" onClick={() => retry()} className="btn btn-secondary mt-4">
        Try again
      </button>
    </div>
  );
}
