'use server';

// Payroll Setup (Organization → Payroll Setup; owner's request, 16 October 2026): each section saves on its own. Each
// action forwards to the API, which checks the session, the role (HR and Admin change the setup) and the limits again,
// so calling these directly can't bypass them. The holidays' are on their own tab now (../holidays/actions.ts).
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { send, shown, submitted } from './replies';
import { payingBody, rulesBody } from './settings';

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
