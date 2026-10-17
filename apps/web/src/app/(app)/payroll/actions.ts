'use server';

// Payroll actions (owner's decisions, 16 October 2026): HR makes a month's run, types the month's figures, refreshes it,
// sends it to the CEO and marks it paid once approved; the CEO approves it or returns it with a reason; a Super Admin
// deletes a draft. Each one forwards to the API, which checks the session, the role and the run's status, so calling
// these directly can't bypass them. Dates are typed as DD/MM/YYYY and sent as YYYY-MM-DD.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import { deleteRefusal } from '@/lib/session';
import type { FormState, PayrollRunView } from '@/lib/types';
import type { LinePatch } from './[id]/grid';
import { isMonth, runHref } from './list';

const UUID = /^[0-9a-f-]{36}$/i;

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
function messagesOf(err: ApiError): string[] {
  // an API from before payroll answers "Cannot POST /api/…" for its addresses
  if (err.status === 404 && err.messages.some((m) => /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(m))) {
    return ['Not available yet: the server does not have payroll yet. Please try again after its next update.'];
  }
  return err.messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));
}

const NOT_FOUND: FormState = { errors: ['This payroll run was not found.'] };

/** Sends the request and shows the change in place (the page is rendered again); `message` closes a small form. */
async function act(request: () => Promise<unknown>, message: string, values?: Record<string, string>): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err), values };
    throw err;
  }
  refresh();
  return { message };
}

/** Makes a month's run, with everyone employed in it on a signed contract, then opens it. */
export async function createRun(_prev: FormState, fd: FormData): Promise<FormState> {
  const month = String(fd.get('month') ?? '');
  if (!isMonth(month)) return { errors: ['Choose the month the run is for.'], values: { month } };
  let run: PayrollRunView | undefined;
  try {
    run = await apiSend<PayrollRunView>('POST', '/payroll/runs', { month });
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err), values: { month } };
    throw err;
  }
  redirect(run?.id ? runHref(run.id) : '/payroll');
}

/** Takes the people, contracts, insured wages and rules afresh, keeping the figures typed (HR, a draft). */
export async function refreshRun(id: string): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  return act(() => apiSend('POST', `/payroll/runs/${id}/refresh`), 'Refreshed.');
}

/** Saves the rows of the inputs grid that changed, in one request (HR, a draft). */
export async function saveRunLines(id: string, lines: LinePatch[]): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  if (!Array.isArray(lines) || lines.length === 0) return { errors: ['Nothing has changed.'] };
  return act(() => apiSend('PATCH', `/payroll/runs/${id}/lines`, { lines }), 'Saved. The pay below is worked out again.');
}

/** Sends a draft to the CEO to approve; it can't be changed meanwhile. */
export async function submitRun(id: string): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  return act(() => apiSend('POST', `/payroll/runs/${id}/submit`), 'Sent to the CEO.');
}

/** The CEO approves the run: it is locked, and the bank details are taken as they are now for the bank files. */
export async function approveRun(id: string): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  return act(() => apiSend('POST', `/payroll/runs/${id}/approve`), 'Approved.');
}

/**
 * The CEO waives a line's attendance deduction, or takes the waiver back, while the run is with the CEO (owner, 17
 * October 2026: "if there is an attendance deduction, allow the CEO to wave the deduction by ticking a box").
 */
export async function setAttendanceWaiver(id: string, lineId: string, waived: boolean): Promise<FormState> {
  if (!UUID.test(id) || !UUID.test(lineId)) return NOT_FOUND;
  if (typeof waived !== 'boolean') return { errors: ['Tick the box to waive the attendance deduction, or untick it to take it again.'] };
  return act(() => apiSend('POST', `/payroll/runs/${id}/lines/${lineId}/attendance-waiver`, { waived }), waived ? 'Waived.' : 'Deducted again.');
}

/** The CEO returns the run to HR as a draft, with the reason HR sees on it. */
export async function returnRun(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const reason = String(fd.get('reason') ?? '').trim();
  if (!reason) return { errors: ['Say why it goes back to HR: HR sees it on the run.'], values: { reason } };
  return act(() => apiSend('POST', `/payroll/runs/${id}/return`, { reason }), 'Returned to HR.', { reason });
}

/** HR marks an approved run paid, on the day the bank paid it. */
export async function markRunPaid(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const errors: string[] = [];
  const paidOn = dateFrom(fd, 'paidOn', 'day it was paid', errors);
  const values = { paidOn: String(fd.get('paidOn') ?? '') };
  if (errors.length) return { errors, values };
  if (!paidOn) return { errors: ['Enter the day it was paid, as DD/MM/YYYY.'], values };
  return act(() => apiSend('POST', `/payroll/runs/${id}/paid`, { paidOn }), 'Marked as paid.', values);
}

/** Deletes a draft run (a Super Admin only), then goes back to the list. */
export async function deleteRun(id: string): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', `/payroll/runs/${id}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err) };
    throw err;
  }
  redirect('/payroll');
}
