import 'server-only';
import { cache } from 'react';
import type { MyTimesheetView, TimesheetListItem, TimesheetWeekView } from '@trendlix/shared';
import { loadJson, type Loaded } from '../payroll/load';
import { myTimesheetApi, timesheetsApi, type TimesheetsQuery } from './timesheets';

// Reading timesheets (owner, 4 November 2026; packages/shared timesheets.ts): the caller's week (My Timesheet), the
// weeks by the list's filters (the approver's, HR's and the CEO's), those waiting for the caller (Approvals, My Team) and
// one week for its page. An API from before them answers 404: "not available yet".

export type { Loaded };

/** GET /me/timesheet?week=: the caller's week, the clients to pick and the weeks before not sent yet. */
export const loadMyTimesheet = (week: string): Promise<Loaded<MyTimesheetView>> => loadJson(myTimesheetApi(week));

/** GET /timesheets: by the list's filters. */
export const loadTimesheets = (q: TimesheetsQuery): Promise<Loaded<TimesheetListItem[]>> => loadJson(timesheetsApi(q));

/** Those waiting for the caller. Read once a request. */
export const loadWaitingTimesheets = cache(() => loadJson<TimesheetListItem[]>(timesheetsApi({ status: 'waiting', week: null })));

/** GET /timesheets/:id: for its person, the one who approves it, HR and the CEO; anyone else gets 404. */
export const loadTimesheet = (id: string): Promise<Loaded<TimesheetWeekView>> => loadJson(`/timesheets/${encodeURIComponent(id)}`);
