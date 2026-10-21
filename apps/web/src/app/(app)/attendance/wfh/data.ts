import 'server-only';
import { cache } from 'react';
import type { WfhAllowance, WfhCalendarItem, WfhCounts, WfhRequestView, WfhSettings } from '@/lib/wfh-types';
import { loadJson, type Loaded } from '../../payroll/load';
import { WAITING_WFH, WFH_COUNTS, wfhListPath, wfhOnDayPath, type WfhQuery } from './wfh';

// Reading working from home (owner, 21 October 2026: "think about how should we handle the working from home in out
// erp"): everyone's for Attendance → Work From Home (HR and the CEO), those waiting for the caller (Approvals, My Team,
// the sidebar, To Approve), the employee's own (My Requests), their month for the form, one for its page, the calendar's
// days and the Leave Setup's limits. An API from before them answers 404: "not available yet".

export type { Loaded };

/** GET /wfh: by the list's filters. */
export const loadWfhRequests = (q: Partial<WfhQuery>): Promise<Loaded<WfhRequestView[]>> => loadJson(wfhListPath(q));

/** Those waiting for the caller. Read once a request. */
export const loadWaitingWfh = cache(() => loadJson<WfhRequestView[]>(WAITING_WFH));

/** { waiting }: how many wait for the caller. Read once a request. */
export const loadWfhCounts = cache(() => loadJson<WfhCounts>(WFH_COUNTS));

/** GET /me/wfh: the employee's own, the latest day first. */
export const loadMyWfh = cache(() => loadJson<WfhRequestView[]>('/me/wfh'));

/** GET /me/wfh/allowance?month=: the caller's month as the form shows it (this month without one). */
export const loadWfhAllowance = cache((month?: string | null) => loadJson<WfhAllowance>(month ? `/me/wfh/allowance?month=${month}` : '/me/wfh/allowance'));

/** GET /wfh/:id: for the employee, the one deciding it, HR and the CEO; anyone else gets 404. */
export const loadWfh = (id: string): Promise<Loaded<WfhRequestView>> => loadJson(`/wfh/${encodeURIComponent(id)}`);

/** The days approved on a date, as far as the caller sees requests (My Team's "who is home today"). */
export const loadWfhOnDay = cache((date: string) => loadJson<WfhRequestView[]>(wfhOnDayPath(date)));

/** GET /wfh/calendar?from=&to=&departmentId=: the days on the leave calendar. */
export function loadWfhCalendar(from: string, to: string, departmentId?: string | null): Promise<Loaded<WfhCalendarItem[]>> {
  const params = new URLSearchParams({ from, to });
  if (departmentId) params.set('departmentId', departmentId);
  return loadJson(`/wfh/calendar?${params.toString()}`);
}

/** GET /wfh/settings: the Leave Setup's limits. */
export const loadWfhSettings = cache(() => loadJson<WfhSettings>('/wfh/settings'));
