import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { SalaryHistory } from '@/lib/raise-types';
import { loadContracts } from '../contracts/data';
import type { VersionRaise } from './salary-history';

// Loading an employee's salary history for the Employment tab's Salary sub-tab (owner's decisions, 16 October 2026). An
// API from before it answers 404, which here means "not available yet" rather than the 404 page, so the rest of the tab
// keeps working.

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

/**
 * Each version's raise (the CEO's step in full, the Form 2) from the employments' contracts, by contract id, for the
 * timeline (it took in the Pay History table, 17 October 2026). An employment whose contracts can't be loaded adds
 * none: its events say what the salary history sends.
 */
export async function loadVersionRaises(employeeId: string, employmentIds: readonly string[]): Promise<Map<string, VersionRaise>> {
  const lists = await Promise.all(
    employmentIds.map((id) =>
      loadContracts(employeeId, id).catch((err: unknown) => {
        if (err instanceof ApiError) return null;
        throw err;
      }),
    ),
  );
  const raises = new Map<string, VersionRaise>();
  for (const c of lists.flat()) if (c?.raise) raises.set(c.id, c.raise);
  return raises;
}
