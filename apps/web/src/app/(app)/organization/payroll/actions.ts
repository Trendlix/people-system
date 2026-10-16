'use server';

// Payroll Setup (Organization → Payroll Setup; owner's request, 16 October 2026): each section saves on its own. Each
// action forwards to the API, which checks the session, the role (HR and Admin change the setup; only a Super Admin
// deletes, so removes a holiday) and the limits again, so calling these directly can't bypass them.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { holidayBody, payingBody, rulesBody } from './settings';

const UUID = /^[0-9a-f-]{36}$/i;

/** The submitted values, so the form can be refilled after an error. */
function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd) if (!key.startsWith('$ACTION') && typeof value === 'string') out[key] = value;
  return out;
}

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const shown = (messages: readonly string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/** Sends one request; the API's refusal comes back as the form's errors, with what was typed. */
async function send(request: () => Promise<unknown>, fd: FormData | null, message: string): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values: fd ? submitted(fd) : undefined };
    throw err;
  }
  refresh();
  return { message };
}

/**
 * 1 Your Rules: the rules runs are worked out with (PATCH /payroll/settings), then the company defaults kept with the
 * contract settings (PATCH /contract-settings): the basic share of the gross new contracts start with and the Form 1
 * basic wage. Both are checked here first, so the second is refused only by what the API alone knows.
 */
export async function updateYourRules(_prev: FormState, fd: FormData): Promise<FormState> {
  const { rules, defaults, errors } = rulesBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  try {
    await apiSend('PATCH', '/payroll/settings', rules);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values: submitted(fd) };
    throw err;
  }
  if (Object.keys(defaults).length) {
    try {
      await apiSend('PATCH', '/contract-settings', defaults);
    } catch (err) {
      if (err instanceof ApiError) {
        refresh();
        return { errors: ['The payroll rules were saved, but not the contract defaults:', ...shown(err.messages)], values: submitted(fd) };
      }
      throw err;
    }
  }
  refresh();
  return { message: 'Saved. Runs made or refreshed from now on use these rules; new contracts and offers start with the basic share.' };
}

/** 4 Paying Salaries: the company's CIB account and its name, the ACH purpose and the payday (PATCH /payroll/settings). */
export async function updatePayingSalaries(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = payingBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  return send(() => apiSend('PATCH', '/payroll/settings', body), fd, 'Saved. The bank files and Mark as paid use these from now on.');
}

/** 3 Holidays and Working Days: a new holiday (POST /payroll/holidays). */
export async function addHoliday(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = holidayBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  return send(() => apiSend('POST', '/payroll/holidays', body), fd, `Added ${body.nameEn} on ${formatDate(body.date)}. Runs made or refreshed from now on count it.`);
}

/** A holiday's day or names changed (PATCH /payroll/holidays/:id). */
export async function updateHoliday(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return { errors: ['This holiday was not found.'] };
  const { body, errors } = holidayBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  return send(() => apiSend('PATCH', `/payroll/holidays/${id}`, body), fd, 'Saved.');
}

/** Removes a holiday (a Super Admin only, as every deletion: DELETE /payroll/holidays/:id). */
export async function deleteHoliday(id: string): Promise<FormState> {
  if (!UUID.test(id)) return { errors: ['This holiday was not found.'] };
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return send(() => apiSend('DELETE', `/payroll/holidays/${id}`), null, 'Removed.');
}
