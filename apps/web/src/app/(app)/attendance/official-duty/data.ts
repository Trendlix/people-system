import 'server-only';
import { cache } from 'react';
import type { OdCalendarItem, OdCounts, OdForm, OdRequestView } from '@/lib/od-types';
import { loadJson, type Loaded } from '../../payroll/load';
import { OD_COUNTS, odListPath, odOnDayPath, WAITING_OD, type OdQuery } from './od';

// Reading official duty (owner, 23 October 2026: "Official duty (OD) requests"): everyone's for Attendance → Official
// Duty (HR and the CEO), those waiting for the caller (Approvals, My Team, the sidebar, To Approve), the employee's own
// (My Requests), what the form reads first, one for its page and the calendar's days. An API from before them answers
// 404: "not available yet".

export type { Loaded };

/** GET /official-duty: by the list's filters. */
export const loadOdRequests = (q: Partial<OdQuery>): Promise<Loaded<OdRequestView[]>> => loadJson(odListPath(q));

/** Those waiting for the caller. Read once a request. */
export const loadWaitingOd = cache(() => loadJson<OdRequestView[]>(WAITING_OD));

/** { waiting }: how many wait for the caller. Read once a request. */
export const loadOdCounts = cache(() => loadJson<OdCounts>(OD_COUNTS));

/** GET /me/official-duty: the employee's own, the latest first day first. */
export const loadMyOd = cache(() => loadJson<OdRequestView[]>('/me/official-duty'));

/** GET /me/official-duty/form: today, the earliest first day, their shift and why they can't ask. */
export const loadOdForm = cache(() => loadJson<OdForm>('/me/official-duty/form'));

/** GET /official-duty/:id: for the employee, the one deciding it, HR and the CEO; anyone else gets 404. */
export const loadOd = (id: string): Promise<Loaded<OdRequestView>> => loadJson(`/official-duty/${encodeURIComponent(id)}`);

/** The official duties approved on a date, as far as the caller sees requests (My Team's "who is out today"). */
export const loadOdOnDay = cache((date: string) => loadJson<OdRequestView[]>(odOnDayPath(date)));

/** GET /official-duty/calendar?from=&to=&departmentId=: the days on the leave calendar. */
export function loadOdCalendar(from: string, to: string, departmentId?: string | null): Promise<Loaded<OdCalendarItem[]>> {
  const params = new URLSearchParams({ from, to });
  if (departmentId) params.set('departmentId', departmentId);
  return loadJson(`/official-duty/calendar?${params.toString()}`);
}
