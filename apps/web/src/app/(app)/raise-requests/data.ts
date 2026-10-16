import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { EmployeeRaiseRequests, RaiseRequest } from '@/lib/raise-types';
import { raiseRequestsHref, type StatusFilter } from './list';

// Reading raise requests (owner's decisions, 16 October 2026): every request for the Raise Requests page, and one
// employee's for their profile. They came with pay raises: an API from before them answers 404, which here means "not
// available yet" rather than the 404 page, so the rest of the page keeps working.

type Load<T> =
  | { kind: 'ok'; value: T }
  /** The server doesn't have raise requests yet. */
  | { kind: 'unavailable' }
  /** Not the caller's to see. */
  | { kind: 'forbidden' }
  | { kind: 'failed'; message: string };

async function load<T>(path: string): Promise<Load<T>> {
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', message: err.message };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'failed', message: (await messagesOf(res)).join(' ') };
  try {
    return { kind: 'ok', value: (await res.json()) as T };
  } catch {
    return { kind: 'failed', message: 'The server sent an answer that could not be read.' };
  }
}

/** GET /raise-requests (HR, the CEO and Finance): newest first, of a status unless All. */
export function loadRaiseRequests(status: StatusFilter): Promise<Load<RaiseRequest[]>> {
  return load<RaiseRequest[]>(raiseRequestsHref(status));
}

/** One employee's raise requests, as read for their profile. */
export type EmployeeRaiseRequestsLoad = Load<EmployeeRaiseRequests>;

/**
 * GET /employees/:id/raise-requests: the employee's requests as the caller may see them (the employee themself, their
 * direct manager, HR, Finance and the CEO; anyone else is refused), and whether the caller may ask for one now.
 */
export function loadEmployeeRaiseRequests(employeeId: string): Promise<EmployeeRaiseRequestsLoad> {
  return load<EmployeeRaiseRequests>(`/employees/${encodeURIComponent(employeeId)}/raise-requests`);
}
