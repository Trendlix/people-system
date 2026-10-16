'use server';

// Raise requests (owner's decisions, 16 October 2026): asking for a raise (the employee for themself, their direct
// manager for a direct report, or HR for anyone, with a reason and, from the employee or HR, a suggested gross), and HR
// declining one with a reason. Each forwards to the API, which checks who may ask (and that a manager states no amount)
// and that only HR declines, so calling these directly can't bypass that. Preparing the raise from a request is the
// raise form's (the Contract section); the CEO's decision on that raise is on Approvals (approvals/actions.ts).
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { parseAmount } from '../employees/[id]/contracts/salary';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/**
 * Asks for a raise for the employee. `suggestsAmount`: whether the asker may suggest a gross (the employee and HR; a
 * manager never states an amount, so none is sent even if typed). The list on the page shows it once sent.
 */
export async function requestRaise(employeeId: string, suggestsAmount: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { reason: text(fd, 'reason'), suggestedGross: text(fd, 'suggestedGross') };
  const errors: string[] = [];
  if (!values.reason) errors.push('Say why the raise is asked for.');
  const suggested = suggestsAmount ? parseAmount(values.suggestedGross) : null;
  if (suggested !== null && (Number.isNaN(suggested) || suggested <= 0))
    errors.push('Enter the suggested gross as an amount in EGP above 0, e.g. 15,000, or leave it empty.');
  if (errors.length) return { errors, values };

  try {
    await apiSend('POST', `/employees/${encodeURIComponent(employeeId)}/raise-requests`, {
      reason: values.reason,
      ...(suggested !== null && { suggestedGross: suggested }),
    });
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  // the profile's list (and HR's count beside Raise Requests in the sidebar) now has it
  refresh();
  return { message: 'Raise request sent. HR prepares the raise or declines it, then the CEO decides; each decision shows here.' };
}

/** HR declines a request with HR, saying why: the employee and their manager see it. A raise prepared from it, not yet sent, goes with it. */
export async function declineRaiseRequest(requestId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { reason: text(fd, 'reason') };
  if (!values.reason) return { errors: ['Write the reason the request is declined: the employee and their manager see it.'], values };

  try {
    await apiSend('POST', `/raise-requests/${encodeURIComponent(requestId)}/decline`, { reason: values.reason });
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  refresh();
  return { message: 'Request declined. The employee and their manager see your reason.' };
}
