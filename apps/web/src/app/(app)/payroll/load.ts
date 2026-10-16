import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';

// Reading the Payroll pages' data (owner, 17 October 2026: Overview, Unsettled, Additions / Deductions, Reports). An
// API from before a page's data answers 404, which here means "not available yet" rather than the 404 page; a refusal
// and any other failure are shown in the page's place.

export type Loaded<T> =
  | { kind: 'ok'; value: T }
  /** The server doesn't have it yet. */
  | { kind: 'unavailable' }
  /** Not the caller's to see (salary data: HR, Finance and the CEO). */
  | { kind: 'forbidden' }
  | { kind: 'failed'; messages: string[] };

/** GET `path` from the API with the caller's session. Signs out on 401. */
export async function loadJson<T>(path: string): Promise<Loaded<T>> {
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', value: (await res.json()) as T };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}

/** What a page says in place of what it couldn't load. */
export function notLoadedText(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return 'Not available yet: the server does not have this yet. Please try again after its next update.';
  if (loaded.kind === 'forbidden') return 'Only HR, Finance and the CEO can see payroll.';
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}
