'use client';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card max-w-xl p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">{error.message || 'The page could not be loaded.'}</p>
      <button type="button" onClick={reset} className="btn btn-secondary mt-4">
        Try again
      </button>
    </div>
  );
}
