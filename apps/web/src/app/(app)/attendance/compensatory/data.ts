import 'server-only';
import { cache } from 'react';
import type { CompensatoryCalendarItem, CompensatoryCounts, CompensatoryForm, CompensatoryRequestView, CompensatorySettings } from '@/lib/compensatory-types';
import { loadJson, type Loaded } from '../../payroll/load';
import { COMPENSATORY_COUNTS, compensatoryListPath, WAITING_COMPENSATORY, type CompensatoryQuery } from './compensatory';

// Reading compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
// month"): everyone's for Attendance → Compensatory Days (HR and the CEO), those waiting for the caller (Approvals, My
// Team, the sidebar), the employee's own (My Requests), the form's live checks, one for its page, the calendar's days and
// the Leave Setup's cash rate. An API from before them answers 404: "not available yet".

export type { Loaded };

/** GET /compensatory: by the list's filters. */
export const loadCompensatoryRequests = (q: Partial<CompensatoryQuery>): Promise<Loaded<CompensatoryRequestView[]>> => loadJson(compensatoryListPath(q));

/** Those waiting for the caller. Read once a request. */
export const loadWaitingCompensatory = cache(() => loadJson<CompensatoryRequestView[]>(WAITING_COMPENSATORY));

/** { waiting }: how many wait for the caller. Read once a request. */
export const loadCompensatoryCounts = cache(() => loadJson<CompensatoryCounts>(COMPENSATORY_COUNTS));

/** GET /me/compensatory: the employee's own, the latest day worked first. */
export const loadMyCompensatory = cache(() => loadJson<CompensatoryRequestView[]>('/me/compensatory'));

/** GET /me/compensatory/form: what the request form checks live. */
export const loadCompensatoryForm = cache(() => loadJson<CompensatoryForm>('/me/compensatory/form'));

/** GET /compensatory/:id: for the employee, the one deciding it, HR and the CEO; anyone else gets 404. */
export const loadCompensatory = (id: string): Promise<Loaded<CompensatoryRequestView>> => loadJson(`/compensatory/${encodeURIComponent(id)}`);

/** GET /compensatory/calendar?from=&to=&departmentId=: the days off on the leave calendar. */
export function loadCompensatoryCalendar(from: string, to: string, departmentId?: string | null): Promise<Loaded<CompensatoryCalendarItem[]>> {
  const params = new URLSearchParams({ from, to });
  if (departmentId) params.set('departmentId', departmentId);
  return loadJson(`/compensatory/calendar?${params.toString()}`);
}

/** GET /compensatory/settings: the Leave Setup's cash rate. */
export const loadCompensatorySettings = cache(() => loadJson<CompensatorySettings>('/compensatory/settings'));
