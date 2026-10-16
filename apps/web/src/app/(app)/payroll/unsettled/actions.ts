'use server';

// Unsettled actions (owner, 17 October 2026): HR marks a final settlement settled or reopens it, records held pay as
// paid out, and records, changes and settles advances and loans. Each one forwards to the API, which checks the session,
// the role and what may be done, so calling these directly can't bypass them. Dates are typed as DD/MM/YYYY and sent as
// YYYY-MM-DD.
import { apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { sendAndRefresh, typedValues, UUID } from '../actions-common';
import { advanceBody, paidOutBody, settleBody } from './unsettled';

const NOT_FOUND: FormState = { errors: ['This was not found. Reload the page and try again.'] };

export async function settleFinal(employmentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(employmentId)) return NOT_FOUND;
  const values = typedValues(fd, ['settledOn', 'amountPaid', 'note', 'documentId']);
  const { body, errors } = settleBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', `/payroll/final-settlements/${employmentId}/settle`, body), 'Marked settled.', values);
}

export async function reopenFinal(employmentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(employmentId)) return NOT_FOUND;
  const reason = String(fd.get('reason') ?? '').trim();
  if (!reason) return { errors: ['Say why it is reopened.'], values: { reason } };
  return sendAndRefresh(() => apiSend('POST', `/payroll/final-settlements/${employmentId}/reopen`, { reason }), 'Reopened.', { reason });
}

export async function recordPaidOut(lineId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(lineId)) return NOT_FOUND;
  const values = typedValues(fd, ['paidOn', 'method', 'note']);
  const { body, errors } = paidOutBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', `/payroll/held-lines/${lineId}/paid-out`, body), 'Recorded as paid out.', values);
}

const ADVANCE_FIELDS = ['employeeId', 'kind', 'amount', 'givenOn', 'reason', 'plan'] as const;

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

export async function settleAdvance(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const note = String(fd.get('note') ?? '').trim();
  if (!note) return { errors: ['Say how it was settled, e.g. paid back in cash.'], values: { note } };
  return sendAndRefresh(() => apiSend('POST', `/payroll/advances/${id}/settle`, { note }), 'Marked settled.', { note });
}
