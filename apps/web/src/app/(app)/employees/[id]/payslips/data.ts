import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { EmployeePayslip } from '@/lib/types';

// Loading an employee's payslips for the profile's Employment tab. They came with payslips (October 2026): an API from
// before them answers 404, which here means "not available yet" rather than the 404 page, so the rest of the profile
// keeps working.

export type PayslipsLoad =
  | { kind: 'ok'; payslips: EmployeePayslip[] }
  /** The server doesn't have payslips yet. */
  | { kind: 'unavailable' }
  /** Not the caller's to see (HR, Finance and the CEO only). */
  | { kind: 'forbidden' }
  | { kind: 'failed'; messages: string[] };

/** GET /employees/:id/payslips: one per run the employee was on, newest month first. Signs out on 401. */
export async function loadPayslips(employeeId: string): Promise<PayslipsLoad> {
  let res: Response;
  try {
    res = await apiFetch(`/employees/${encodeURIComponent(employeeId)}/payslips`);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    const list = (await res.json()) as EmployeePayslip[] | null;
    return { kind: 'ok', payslips: Array.isArray(list) ? list : [] };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}
