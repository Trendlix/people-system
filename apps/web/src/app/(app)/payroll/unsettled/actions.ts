'use server';

// Unsettled actions (owner, 17 October 2026): HR marks a final settlement settled or reopens it, records held pay as
// paid out, and records, changes and settles advances and loans; since 18 October 2026 (owner: "in the deductions i might
// have a loan of a medical subscription or something that needs to be deducted as installments on the employee. how will
// it be managed?") an advance or loan is recorded with its installments, one is moved to the next month or changed, and
// one is settled in one of three ways: paid back, deducted from the final settlement, or waived with a note (leaving:
// "taken from the final settlement, unless waived"). Each one forwards to the API, which checks the session, the role
// and what may be done, so calling these directly can't bypass them. Dates are typed as DD/MM/YYYY and sent as
// YYYY-MM-DD; months are YYYY-MM.
import { apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { sendAndRefresh, typedValues, UUID } from '../actions-common';
import { isMonth } from '../list';
import { changeBody, settleAdvanceBody } from './installments';
import { advanceBody, paidOutBody, settleBody } from './unsettled';

const NOT_FOUND: FormState = { errors: ['This was not found. Reload the page and try again.'] };

export async function settleFinal(employmentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(employmentId)) return NOT_FOUND;
  const values = typedValues(fd, ['settledOn', 'amountPaid', 'note', 'documentId']);
  const { body, errors } = settleBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', `/payroll/final-settlements/${employmentId}/settle`, body), 'Marked settled.', values);
}

/**
 * HR records a final settlement's unused annual leave paid (owner, 18 October 2026; Labour Law Art. 125): an Unused leave
 * paid addition, taxed, on the payroll of the final month, or the next one open.
 */
export async function payUnusedLeave(employmentId: string): Promise<FormState> {
  if (!UUID.test(employmentId)) return NOT_FOUND;
  return sendAndRefresh(() => apiSend('POST', `/payroll/final-settlements/${employmentId}/unused-leave`), 'Recorded: added to the payroll as Unused leave paid.');
}

export async function reopenFinal(employmentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(employmentId)) return NOT_FOUND;
  const reason = String(fd.get('reason') ?? '').trim();
  if (!reason) return { errors: ['Say why it is reopened.'], values: { reason } };
  return sendAndRefresh(() => apiSend('POST', `/payroll/final-settlements/${employmentId}/reopen`, { reason }), 'Reopened.', { reason });
}

/**
 * HR marks a leave or attendance change made after the month's payroll moved on handled, once corrected by hand on a later
 * payroll (owner's brief, 27 October 2026): a note, optional.
 */
export async function markLockedChangeHandled(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const note = String(fd.get('note') ?? '').trim();
  return sendAndRefresh(() => apiSend('POST', `/payroll/locked-changes/${id}/handled`, note ? { note } : {}), 'Marked handled.', { note });
}

export async function recordPaidOut(lineId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(lineId)) return NOT_FOUND;
  const values = typedValues(fd, ['paidOn', 'method', 'note']);
  const { body, errors } = paidOutBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', `/payroll/held-lines/${lineId}/paid-out`, body), 'Recorded as paid out.', values);
}

const ADVANCE_FIELDS = ['employeeId', 'kind', 'amount', 'givenOn', 'reason', 'plan', 'byInstallments', 'count', 'firstMonth'] as const;

export async function createAdvance(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd, ADVANCE_FIELDS);
  const { body, errors } = advanceBody(fd, true);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', '/payroll/advances', body), 'Recorded.', values);
}

export async function updateAdvance(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const values = typedValues(fd, ADVANCE_FIELDS);
  const { body, errors } = advanceBody(fd, false);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('PATCH', `/payroll/advances/${id}`, body), 'Saved.', values);
}

/** Marks one settled with something outstanding: paid back, deducted from the final settlement, or waived (a note why). */
export async function settleAdvance(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const values = typedValues(fd, ['how', 'note']);
  const { body, errors } = settleAdvanceBody(fd);
  if (errors.length) return { errors, values };
  const done = body.how === 'waived' ? 'Waived.' : body.how === 'final_settlement' ? 'Recorded as deducted from the final settlement.' : 'Marked settled.';
  return sendAndRefresh(() => apiSend('POST', `/payroll/advances/${id}/settle`, body), done, values);
}

/** Deducted from the final settlement (a final settlement's "To deduct from the final settlement"): no note needed. */
export async function deductFromFinal(id: string): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  return sendAndRefresh(() => apiSend('POST', `/payroll/advances/${id}/settle`, { how: 'final_settlement', note: null }), 'Recorded as deducted from the final settlement.');
}

/** Moves the installment of `month`, and every later pending one, a month on. */
export async function postponeInstallment(id: string, month: string): Promise<FormState> {
  if (!UUID.test(id) || !isMonth(month)) return NOT_FOUND;
  return sendAndRefresh(() => apiSend('POST', `/payroll/advances/${id}/installments/postpone`, { month }), 'Moved a month on.');
}

/** Changes the installment of a month: the later pending ones share what is left. */
export async function changeInstallment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const values = typedValues(fd, ['month', 'amount']);
  const { body, errors } = changeBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', `/payroll/advances/${id}/installments/change`, body), 'Changed.', values);
}
