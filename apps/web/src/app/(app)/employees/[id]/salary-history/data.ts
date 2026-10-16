import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { SalaryHistory } from '@/lib/raise-types';

// Loading an employee's salary history for the Employment tab (owner's decisions, 16 October 2026). An API from before
// it answers 404, which here means "not available yet" rather than the 404 page, so the rest of the tab keeps working.

export type SalaryHistoryLoad =
  | { kind: 'ok'; history: SalaryHistory }
  /** The server doesn't have the salary history yet. */
  | { kind: 'unavailable' }
  /** Not the caller's to see (HR, Finance and the CEO only, as salaries). */
  | { kind: 'forbidden' }
  | { kind: 'failed'; messages: string[] };

/** GET /employees/:id/salary-history: each employment, the current one first. Signs out on 401. */
export async function loadSalaryHistory(employeeId: string): Promise<SalaryHistoryLoad> {
  let res: Response;
  try {
    res = await apiFetch(`/employees/${encodeURIComponent(employeeId)}/salary-history`);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    const body = (await res.json()) as SalaryHistory | null;
    return { kind: 'ok', history: { employments: Array.isArray(body?.employments) ? body.employments : [] } };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}
