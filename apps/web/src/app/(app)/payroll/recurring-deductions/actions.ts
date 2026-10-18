'use server';

// Recurring Deductions actions (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription
// or something that needs to be deducted as installments on the employee. how will it be managed?"): HR adds one,
// changes its amount from a month, stops it from a month, and changes its name or last month. Each one forwards to the
// API, which checks the session, the role and the months whose runs are approved, so calling these directly can't
// bypass them. Months are YYYY-MM.
import { apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { sendAndRefresh, typedValues, UUID } from '../actions-common';
import { changeRecurringBody, editRecurringBody, recurringBody, stopRecurringBody } from './recurring';

const NOT_FOUND: FormState = { errors: ['This recurring deduction was not found. Reload the page and try again.'] };

export async function createRecurring(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd, ['employeeId', 'name', 'amount', 'startMonth', 'endMonth']);
  const { body, errors } = recurringBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', '/payroll/recurring-deductions', body), 'Added.', values);
}

export async function changeRecurring(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const values = typedValues(fd, ['amount', 'fromMonth']);
  const { body, errors } = changeRecurringBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', `/payroll/recurring-deductions/${id}/change`, body), 'Changed.', values);
}

export async function stopRecurring(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const values = typedValues(fd, ['fromMonth', 'note']);
  const { body, errors } = stopRecurringBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', `/payroll/recurring-deductions/${id}/stop`, body), 'Stopped.', values);
}

export async function editRecurring(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const values = typedValues(fd, ['name', 'endMonth']);
  const { body, errors } = editRecurringBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('PATCH', `/payroll/recurring-deductions/${id}`, body), 'Saved.', values);
}
