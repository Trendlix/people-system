import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from './api';

// Reading interview hours and calendars for the pages (owner, 25 October 2026: "Hours + calendar"; "its zoho mails"):
// the answer, or why not: `unavailable` an API from before them (its 404 says "Cannot GET …"), `missing` a 404 of its own
// (not theirs to open, or no employee profile, in the API's words), `failed` anything else, in the API's words.

export type Loaded<T> = { kind: 'ok'; value: T } | { kind: 'unavailable' } | { kind: 'missing'; messages: string[] } | { kind: 'failed'; messages: string[] };

/** GET `path` from the API, as the pages read it. */
export async function loadJson<T>(path: string): Promise<Loaded<T>> {
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) {
    const messages = await messagesOf(res);
    return messages.every((m) => /^Cannot |^Request failed/.test(m)) ? { kind: 'unavailable' } : { kind: 'missing', messages };
  }
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', value: (await res.json()) as T };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}
