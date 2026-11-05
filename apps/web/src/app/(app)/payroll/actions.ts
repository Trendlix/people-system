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
import type { PayrollInputs } from '@trendlix/shared';
import type { FormState, PayrollBankBatchView, PayrollBankFile, PayrollRunView } from '@/lib/types';
import type { LinePatch } from './[id]/grid';
import { todayInCairo } from '../employees/ui';
import { valueDateFrom } from './files';
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

/**
 * Refresh from attendance (owner, 19 October 2026: "Check-in through the system (phone or web with the office location
 * check, or a device) to replace Zoho"): a draft's lines of those who check in on the system, or whose days were
 * corrected, filled again from the month's attendance days (HR and the CEO; the API refuses any other run, 409).
 */
export async function refreshFromAttendance(id: string): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  return act(() => apiSend('POST', `/payroll/runs/${id}/attendance-refresh`), 'Filled again from the attendance days.');
}

/**
 * Saves the rows of the inputs grid that changed, in one request (a draft: HR's lines, and the C-level people's the
 * CEO's, owner, 19 October 2026: "the CEO fills their inputs"; the API refuses a line that isn't the caller's).
 */
export async function saveRunLines(id: string, lines: LinePatch[]): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  if (!Array.isArray(lines) || lines.length === 0) return { errors: ['Nothing has changed.'] };
  return act(() => apiSend('PATCH', `/payroll/runs/${id}/lines`, { lines }), 'Saved.');
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

/**
 * Corrects a line of an approved or paid run (owner, 5 November 2026: "if there was a problem in the employee calculation
 * and has been edited"; asked, "Payslip and register too"): the figures changed and why. The API works the line out
 * again; the register, the payslip and what the bank batches still pay follow.
 */
export async function correctPayrollLine(id: string, lineId: string, inputs: Partial<PayrollInputs>, reason: string): Promise<FormState> {
  if (!UUID.test(id) || !UUID.test(lineId)) return NOT_FOUND;
  if (typeof reason !== 'string' || !reason.trim()) return { errors: ['Write why the line is corrected.'] };
  if (!inputs || typeof inputs !== 'object' || !Object.keys(inputs).length) return { errors: ['Change at least one figure to correct the line.'] };
  return act(() => apiSend('POST', `/payroll/runs/${id}/lines/${lineId}/correct`, { inputs, reason: reason.trim() }), 'Corrected.');
}

/**
 * The CEO waives a line's KPI deduction, or takes the waiver back, while the run is with the CEO (owner, 1 November
 * 2026: "make a button wave KPI deduction like the attendance one").
 */
export async function setKpiWaiver(id: string, lineId: string, waived: boolean): Promise<FormState> {
  if (!UUID.test(id) || !UUID.test(lineId)) return NOT_FOUND;
  if (typeof waived !== 'boolean') return { errors: ['Tick the box to waive the KPI deduction, or untick it to take it again.'] };
  return act(() => apiSend('POST', `/payroll/runs/${id}/lines/${lineId}/kpi-waiver`, { waived }), waived ? 'Waived.' : 'Deducted again.');
}

/** The CEO returns the run to HR as a draft, with the reason HR sees on it. */
export async function returnRun(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const reason = String(fd.get('reason') ?? '').trim();
  if (!reason) return { errors: ['Say why it goes back to HR.'], values: { reason } };
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

/** What making a batch answers: the batch made, whose file the page then downloads, or why not. */
export type BankBatchResult = { batchId?: string; errors?: string[] };

/**
 * Makes a bank transfer batch of the people ticked for one bank file of an approved run (owner, 5 November 2026: "allow
 * me to select a group of people for the transfer"; asked, "Tick names"), the CIB file's with its value date (typed as
 * DD/MM/YYYY, today when empty). The page then downloads its file; the batch is listed, to be confirmed once sent.
 */
export async function makeBankBatch(id: string, file: PayrollBankFile, lineIds: string[], valueDate: string | null): Promise<BankBatchResult> {
  if (!UUID.test(id)) return { errors: NOT_FOUND.errors };
  if (file !== 'cib' && file !== 'ach') return { errors: ['Choose the CIB file or the ACH file.'] };
  if (!Array.isArray(lineIds) || !lineIds.every((l) => typeof l === 'string' && UUID.test(l))) return { errors: ['Tick the people again.'] };
  if (!lineIds.length) return { errors: ['Tick at least one person.'] };
  const date = file === 'cib' ? valueDateFrom(valueDate, todayInCairo()) : null;
  if (file === 'cib' && !date) return { errors: ['Enter the value date as DD/MM/YYYY, e.g. 16/10/2026.'] };
  let batch: PayrollBankBatchView | undefined;
  try {
    batch = await apiSend<PayrollBankBatchView>('POST', `/payroll/runs/${id}/bank-batches`, { file, lineIds: [...new Set(lineIds)], ...(date && { valueDate: date }) });
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err) };
    throw err;
  }
  refresh();
  return batch?.id ? { batchId: batch.id } : { errors: ['The batch was made, but its file could not be found: download it from the batches below.'] };
}

/** Records a batch as sent to the bank (owner, 5 November 2026: "and to confirm each batch sent to be recorded"). */
export async function confirmBankBatchSent(id: string, batchId: string): Promise<FormState> {
  if (!UUID.test(id) || !UUID.test(batchId)) return NOT_FOUND;
  return act(() => apiSend('POST', `/payroll/runs/${id}/bank-batches/${batchId}/sent`), 'Recorded as sent to the bank.');
}

/** Discards a batch that wasn't sent to the bank: its people can be ticked again. */
export async function discardBankBatch(id: string, batchId: string): Promise<FormState> {
  if (!UUID.test(id) || !UUID.test(batchId)) return NOT_FOUND;
  return act(() => apiSend('DELETE', `/payroll/runs/${id}/bank-batches/${batchId}`), 'Discarded.');
}
