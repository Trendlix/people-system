'use server';

// Timesheets (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly"): the caller's week saved
// (all its lines: what is sent replaces what was), sent for approval (saved first), and a week approved or rejected
// with why by the one it waits for. Each forwards to the API, which checks the week's rules, who logs hours and who
// decides, so calling these directly can't bypass that; the pages are read again after.
import { refresh } from 'next/cache';
import type { MyTimesheetView, TimesheetEntryInput, TimesheetWeekView } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { shownMessage } from '../leave/permissions';
import { myTimesheetApi, submitTimesheetApi } from './timesheets';

const shown = (messages: string[]) => messages.map(shownMessage);

/** The week's lines saved (PUT /me/timesheet?week=). */
export async function saveMyTimesheet(week: string, entries: TimesheetEntryInput[]): Promise<FormState> {
  try {
    await apiSend<MyTimesheetView>('PUT', myTimesheetApi(week), { entries });
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  refresh();
  return { message: 'Saved.' };
}

/** The week saved, then sent to the one who approves it (POST /me/timesheet/submit?week=). */
export async function sendMyTimesheet(week: string, entries: TimesheetEntryInput[]): Promise<FormState> {
  try {
    await apiSend<MyTimesheetView>('PUT', myTimesheetApi(week), { entries });
    await apiSend<MyTimesheetView>('POST', submitTimesheetApi(week));
  } catch (err) {
    refresh();
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  refresh();
  return { message: 'Sent for approval.' };
}

/** A week approved, or rejected with why (POST /timesheets/:id/decide). */
export async function decideTimesheet(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const decision = String(fd.get('decision') ?? '');
  const comment = String(fd.get('comment') ?? '').trim();
  const values = { decision, comment };
  if (decision !== 'approve' && decision !== 'reject') return { errors: ['Choose your decision: approve or reject.'], values };
  if (decision === 'reject' && !comment) return { errors: ['Write why you reject it.'], values };
  try {
    await apiSend<TimesheetWeekView>('POST', `/timesheets/${encodeURIComponent(id)}/decide`, { decision, ...(comment && { comment }) });
  } catch (err) {
    refresh();
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  return { message: decision === 'approve' ? 'Approved.' : 'Rejected.' };
}
