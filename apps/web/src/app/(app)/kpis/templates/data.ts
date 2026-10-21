import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf, signedOutPath } from '@/lib/api';
import type { Loaded } from '../../organization/payroll/data';

// What KPI Templates reads (owner, 21 October 2026: "Templates: HR"), each part on its own: an API from before the KPIs
// answers 404 ("not available yet") and the part says so, the rest of the page still showing.

export async function loadKpi<T>(path: string): Promise<Loaded<T>> {
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', message: err.message };
    throw err;
  }
  if (res.status === 401) redirect(await signedOutPath(res));
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', message: (await messagesOf(res)).join(' ') };
  try {
    return { kind: 'ok', value: (await res.json()) as T };
  } catch {
    return { kind: 'failed', message: 'The server sent an answer that could not be read.' };
  }
}
