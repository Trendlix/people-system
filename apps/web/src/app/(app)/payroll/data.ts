import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { PayrollRunSummary, PayrollRunView } from '@/lib/types';

// Reading payroll runs (owner's decisions, 16 October 2026). An API from before payroll answers "Cannot GET /api/…"
// with a 404, which here means "not available yet" rather than the 404 page; any other failure of the list is shown
// quietly in its place.

const UUID = /^[0-9a-f-]{36}$/i;

/** Whether a 404's messages are the server's own "Cannot GET /api/…" for an address it doesn't have. */
const isMissingRoute = (messages: readonly string[]) => messages.some((m) => /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(m));

export type RunListing = { kind: 'ok'; rows: PayrollRunSummary[] } | { kind: 'unavailable' } | { kind: 'failed'; message: string };

/** GET /payroll/runs: every run, newest month first. */
export async function loadRuns(): Promise<RunListing> {
  let res: Response;
  try {
    res = await apiFetch('/payroll/runs');
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', message: err.message };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', message: (await messagesOf(res)).join(' ') };
  try {
    return { kind: 'ok', rows: (await res.json()) as PayrollRunSummary[] };
  } catch {
    return { kind: 'failed', message: 'The server sent an answer that could not be read.' };
  }
}

/**
 * The run in the address: null when the server doesn't have payroll yet; the 404 page for a bad id or one that isn't
 * there. Throws ApiError for anything else (the error page).
 */
export async function loadRun(params: Promise<{ id: string }>): Promise<PayrollRunView | null> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const res = await apiFetch(`/payroll/runs/${id}`);
  if (res.status === 401) redirect('/login');
  if (res.status === 404) {
    if (isMissingRoute(await messagesOf(res))) return null;
    notFound();
  }
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
  return (await res.json()) as PayrollRunView;
}
