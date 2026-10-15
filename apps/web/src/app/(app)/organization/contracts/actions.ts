'use server';

// Contract defaults and ending rules (Organization → Contracts & Endings). Each one forwards to the API, which checks
// the session and the HR/Admin role and the law's limits (probation at most 3 months, Art. 90; resignation and the
// company's notice at least 3 months, Art. 156), so calling these directly can't bypass them.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/** A number field; an empty one is left out, for the API to say it is missing. */
const whole = (fd: FormData, key: string) => {
  const value = text(fd, key).trim();
  return value === '' ? undefined : Number(value);
};

/** The submitted values, so the form can be refilled after an error. */
function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd) if (!key.startsWith('$ACTION') && typeof value === 'string') out[key] = value;
  return out;
}

/** What a new contract starts with: the probation and how long it runs, in months. */
export async function updateContractSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const body = { probationMonths: whole(fd, 'probationMonths'), durationMonths: whole(fd, 'durationMonths') };
  try {
    await apiSend('PATCH', '/contract-settings', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  refresh();
  return { message: 'Contract defaults saved. New contracts start with them.' };
}

/** A rule's label, notice, pay in lieu and whether it is offered. Who starts it, how it ends and its source stay. */
export async function updateEndingRule(key: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const body = {
    label: text(fd, 'label'),
    noticeAmount: whole(fd, 'noticeAmount'),
    noticeUnit: text(fd, 'noticeUnit'),
    payInLieu: fd.get('payInLieu') === 'true',
    active: fd.get('active') === 'true',
  };
  try {
    await apiSend('PATCH', `/ending-rules/${encodeURIComponent(key)}`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  redirect('/organization/contracts');
}
