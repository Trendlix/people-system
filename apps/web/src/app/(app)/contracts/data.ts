import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { ContractListItem } from '@/lib/types';
import { mergeAll } from './list';

// Reading the company-wide contract list (GET /contracts, October 2026). An API from before it answers 404, which here
// means "not available yet" rather than the 404 page, and any other failure is shown quietly in its place, so the rest
// of the Contracts page keeps working.

export type Listing =
  | { kind: 'ok'; rows: ContractListItem[] }
  | { kind: 'unavailable' }
  | { kind: 'failed'; message: string };

async function getList(path: string): Promise<Listing> {
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', message: err.message };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', message: (await messagesOf(res)).join(' ') };
  try {
    return { kind: 'ok', rows: (await res.json()) as ContractListItem[] };
  } catch {
    return { kind: 'failed', message: 'The server sent an answer that could not be read.' };
  }
}

/** The contracts for these paths (from `listPaths`), as one list; unavailable or failed when any of them is. */
export async function loadContractList(paths: string[]): Promise<Listing> {
  const answers = await Promise.all(paths.map(getList));
  const notOk = answers.find((a) => a.kind !== 'ok');
  if (notOk) return notOk;
  return { kind: 'ok', rows: mergeAll(answers.map((a) => (a.kind === 'ok' ? a.rows : []))) };
}
