import 'server-only';
import { redirect } from 'next/navigation';
import type { ReportPeriod } from '@trendlix/shared';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import { apiReportPath, type SalaryRaisesView } from './salary-raises';

// Loading the Salary Raises report (owner's decision, 16 October 2026). An API from before it answers 404, which here
// means "not available yet" rather than the 404 page.

export type SalaryRaisesLoad =
  | { kind: 'ok'; report: SalaryRaisesView }
  /** The server doesn't have the report yet. */
  | { kind: 'unavailable' }
  /** Not the caller's to see (HR, Finance and the CEO only, as salaries). */
  | { kind: 'forbidden' }
  | { kind: 'failed'; messages: string[] };

/** GET /reports/salary-raises?from=&to=. Signs out on 401. */
export async function loadSalaryRaises(period: ReportPeriod): Promise<SalaryRaisesLoad> {
  let res: Response;
  try {
    res = await apiFetch(apiReportPath(period));
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', report: (await res.json()) as SalaryRaisesView };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}
