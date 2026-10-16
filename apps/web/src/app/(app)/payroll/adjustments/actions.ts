'use server';

// Additions / Deductions actions (owner, 17 October 2026): HR enters an addition or deduction for an employee's month,
// changes a pending one and cancels it, and moves one left on a month approved without it to a later month. Each one forwards to the API, which checks the session, the role and whether the
// month's run still allows it, so calling these directly can't bypass them.
import { apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { sendAndRefresh, typedValues, UUID } from '../actions-common';
import { isMonth } from '../list';
import { adjustmentBody } from './adjustments';

const FIELDS = ['employeeId', 'kind', 'month', 'type', 'taxed', 'amount', 'reason', 'advanceId'] as const;
const NOT_FOUND: FormState = { errors: ['This addition or deduction was not found.'] };

export async function createAdjustment(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd, FIELDS);
  const { body, errors } = adjustmentBody(fd, true);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', '/payroll/adjustments', body), 'Added.', values);
}

export async function updateAdjustment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const values = typedValues(fd, FIELDS);
  const { body, errors } = adjustmentBody(fd, false);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('PATCH', `/payroll/adjustments/${id}`, body), 'Saved.', values);
}

export async function cancelAdjustment(id: string): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  return sendAndRefresh(() => apiSend('POST', `/payroll/adjustments/${id}/cancel`, {}), 'Cancelled.');
}

/** Moves pending ones to another month: those left on a month approved without them, to a later one. */
export async function moveAdjustments(ids: string[], _prev: FormState, fd: FormData): Promise<FormState> {
  const month = String(fd.get('month') ?? '');
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => !UUID.test(id))) return NOT_FOUND;
  if (!isMonth(month)) return { errors: ['Choose the month to move them to.'], values: { month } };
  return sendAndRefresh(() => apiSend('POST', '/payroll/adjustments/move', { ids, month }), ids.length === 1 ? 'Moved.' : `Moved ${ids.length}.`, { month });
}
