'use server';

// Recurring Deductions actions (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription
// or something that needs to be deducted as installments on the employee. how will it be managed?"): HR adds one,
// changes its amount from a month, stops it from a month, and changes its name or last month. The employee's written
// consent (owner, 18 October 2026, after reading the law: "record the consent"; Labour Law Art. 114): ticked to add
// one, with the signed consent attached if HR has it (sent as a form), recorded later for one added before, or its
// signed consent attached later; ticked again for a higher amount. Deducted before tax (owner, 20 October 2026: "Before
// Tax i think"): ticked or not on the add, change and edit forms. Each one forwards to the API, which checks the
// session, the role, the consent and the months whose runs are approved, so calling these directly can't bypass them.
// Months are YYYY-MM.
import { apiSend, apiUpload } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { sendAndRefresh, typedValues, UUID } from '../actions-common';
import { changeRecurringBody, consentBody, consentForm, editRecurringBody, recurringBody, recurringForm, stopRecurringBody } from './recurring';

const NOT_FOUND: FormState = { errors: ['This recurring deduction was not found. Reload the page and try again.'] };

/** Adds one: a form (multipart), the signed consent with it when chosen. */
export async function createRecurring(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd, ['employeeId', 'name', 'amount', 'startMonth', 'endMonth', 'beforeTax', 'consentOnFile']);
  const { body, file, errors } = recurringBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiUpload('POST', '/payroll/recurring-deductions', recurringForm(body, file)), file ? 'Added, with the signed consent.' : 'Added.', values);
}

/** Changes the amount from a month; `saved`: the amount it has, a higher one needing the consent ticked again. */
export async function changeRecurring(id: string, saved: number, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const values = typedValues(fd, ['amount', 'fromMonth', 'beforeTax', 'consentOnFile']);
  const { body, errors } = changeRecurringBody(fd, saved);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('POST', `/payroll/recurring-deductions/${id}/change`, body), 'Changed.', values);
}

/** Records the consent of one added before it was asked, or attaches the signed consent (a form, multipart). */
export async function recordConsent(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return NOT_FOUND;
  const values = typedValues(fd, ['consentOnFile', 'recorded']);
  const { file, errors } = consentBody(fd);
  if (errors.length) return { errors, values };
  const done = !file ? 'Consent recorded.' : values.recorded === 'yes' ? 'Signed consent attached.' : 'Consent recorded, with the signed consent.';
  return sendAndRefresh(() => apiUpload('POST', `/payroll/recurring-deductions/${id}/consent`, consentForm(file)), done, values);
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
  const values = typedValues(fd, ['name', 'endMonth', 'beforeTax']);
  const { body, errors } = editRecurringBody(fd);
  if (errors.length) return { errors, values };
  return sendAndRefresh(() => apiSend('PATCH', `/payroll/recurring-deductions/${id}`, body), 'Saved.', values);
}
