'use client';

// Next.js hides server error details in production, so show a plain message instead of error.message.
// `retry` re-fetches the page's data and renders it again.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="card max-w-xl p-6">
      <h1 className="text-lg font-semibold">This Page Could Not Be Loaded</h1>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <button type="button" onClick={() => retry()} className="btn btn-secondary mt-4">
        Try again
      </button>
    </div>
  );
}
