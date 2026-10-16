'use server';

// The payroll settings (Organization → Payroll). Forwards to the API, which checks the session and the HR/Admin role
// and the limits again, so calling this directly can't bypass them.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { settingsBody } from './settings';

/** The submitted values, so the form can be refilled after an error. */
function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd) if (!key.startsWith('$ACTION') && typeof value === 'string') out[key] = value;
  return out;
}

/** The rules new runs are worked out with, and what the bank files need. */
export async function updatePayrollSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = settingsBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  try {
    await apiSend('PATCH', '/payroll/settings', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  refresh();
  return { message: 'Payroll settings saved. Runs made or refreshed from now on use them.' };
}
