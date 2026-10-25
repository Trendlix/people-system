'use server';

// Organization → Leave (owner, 18 October 2026: "can you apply the leaves according to the law?", "make it with decision
// with the year closing"): saving the annual leave's days (PATCH /leave/settings), adding a leave type, changing one
// (its rules, turning it off or on) and deleting one no request uses, and closing a year (or opening it again). Each
// forwards to the API, which checks the role (HR changes them; only a Super Admin deletes) and the rules again, so calling
// these directly can't bypass them. A team's staffing limit for annual leave (owner, 25 October 2026: "Warn and need
// HR"), set by HR or a Super Admin (PUT /leave/staffing/:departmentId).
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { asShown } from '../../leave/request';
import { closingBody } from './year-closing';
import { LEAVE_TYPES_HREF, settingsBody, typeBody, yearClosingHref } from './setup';
import { staffingBody, staffingSavedText } from './staffing';

/** The submitted values, so the form can be refilled after an error. */
function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith('$ACTION')) continue;
    out[key] = String(fd.get(key) ?? '');
  }
  return out;
}

/**
 * The annual leave's days (PATCH /leave/settings): all of them, as the form has them, with the permission hours a month
 * and most a day (19 October 2026) when it has them; the API's refusals (permissionRulesProblems) shown as they come.
 */
export async function saveLeaveSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = settingsBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  try {
    await apiSend('PATCH', '/leave/settings', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  refresh();
  return {
    message:
      body.permissionHoursPerMonth !== undefined
        ? 'Saved. Balances are worked out with these days from now on, and new permission requests are checked against these hours.'
        : 'Saved. Balances are worked out with these days from now on.',
  };
}

async function saveType(fd: FormData, request: () => Promise<unknown>): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  redirect(LEAVE_TYPES_HREF);
}

/** A new leave type (POST /leave/types), HR's own: the API makes its kind custom. */
export async function createLeaveType(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = typeBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  return saveType(fd, () => apiSend('POST', '/leave/types', body));
}

/** A type changed (PATCH /leave/types/:id): every rule, as the form has it. The requests sent keep their days. */
export async function updateLeaveType(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = typeBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  return saveType(fd, () => apiSend('PATCH', `/leave/types/${encodeURIComponent(id)}`, body));
}

/** Deletes a type no request uses (DELETE /leave/types/:id): a Super Admin only; anyone else is refused first. */
export async function deleteLeaveType(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return saveType(fd, () => apiSend('DELETE', `/leave/types/${encodeURIComponent(id)}`));
}

/**
 * Closes a year (POST /leave/year-closing/:year): for each employee, the days carried into the next year and the days
 * paid, which must add up to their unused days (Art. 125: "لا يجوز للعامل النزول عن إجازته"), the days carried for three
 * years paid. The pay is added to the January payroll (or the next one open) as Unused leave paid.
 */
export async function closeLeaveYear(year: number, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = closingBody(fd);
  if (!body) return { errors, values: submitted(fd) };
  try {
    await apiSend('POST', `/leave/year-closing/${year}`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages.map(asShown), values: submitted(fd) };
    throw err;
  }
  refresh();
  redirect(`${yearClosingHref(year)}&done=closed`);
}

/** Opens a closed year again (POST /leave/year-closing/:year/reopen), while its payouts aren't paid with a payroll yet. */
export async function reopenLeaveYear(year: number): Promise<FormState> {
  try {
    await apiSend('POST', `/leave/year-closing/${year}/reopen`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages.map(asShown) };
    throw err;
  }
  refresh();
  redirect(`${yearClosingHref(year)}&done=reopened`);
}

/**
 * A team's staffing limit (or a department's without teams), PUT /leave/staffing/:departmentId (owner, 25 October 2026:
 * "Warn and need HR"): at most so many on annual leave at once and/or at least so many percent at work; both empty removes
 * it. What the API refuses (a department with teams, a figure out of range) shows on the row, with what was typed.
 */
export async function saveStaffingLimit(departmentId: string, name: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = staffingBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  try {
    await apiSend('PUT', `/leave/staffing/${encodeURIComponent(departmentId)}`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  refresh();
  return { message: staffingSavedText(name, body) };
}
