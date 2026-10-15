'use server';

// Employment actions: hiring someone whose profile exists (again, after an earlier employment ended), changing an
// employment (the current one, or an ended one in the history), ending the current one, and deleting one added by
// mistake. Each one forwards to the API, which checks the session and the HR role (deleting: a Super Admin only), so
// calling these directly can't bypass permissions. Dates are typed as DD/MM/YYYY and sent as YYYY-MM-DD.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { profileHref } from './ui';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/** The submitted values, so the form can be refilled after an error. */
function submitted(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith('$ACTION')) continue;
    const all = fd.getAll(key).filter((v) => typeof v === 'string');
    if (all.length > 0) out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/** Sends the request unless reading the form already found mistakes, then goes back to the profile's Employment tab. */
async function save(employeeId: string, fd: FormData, errors: string[], request: () => Promise<unknown>): Promise<FormState> {
  if (errors.length) return { errors, values: submitted(fd) };
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values: submitted(fd) };
    throw err;
  }
  redirect(profileHref(employeeId, 'employment'));
}

/**
 * The employment's fields (employment-fields.tsx). `withStatus`: a current employment's status (an ended one's follows
 * why it ended). A job title picker left disabled sends nothing, which clears the job title. `gradeId`: the person's
 * own grade ("" clears it); the API refuses one outside the job title's range.
 */
function employmentBody(fd: FormData, errors: string[], withStatus: boolean) {
  const workArrangement = text(fd, 'workArrangement');
  return {
    employmentType: text(fd, 'employmentType'),
    ...(withStatus && { status: text(fd, 'status') }),
    // the form keeps the team in line with the job title, so the API gets a matching pair
    departmentId: text(fd, 'departmentId'),
    jobTitleId: text(fd, 'jobTitleId'),
    gradeId: text(fd, 'gradeId'),
    managerId: text(fd, 'managerId'),
    joinDate: dateFrom(fd, 'joinDate', 'join date', errors),
    workArrangement,
    officeDays: workArrangement === 'hybrid' ? fd.getAll('officeDays').map(Number) : [],
    shiftId: text(fd, 'shiftId'),
    jdAcknowledgedAt: dateFrom(fd, 'jdAcknowledgedAt', 'job description acknowledgement date', errors),
  };
}

/** How an employment ended: the last working day, why, and a note. */
function endBody(fd: FormData, errors: string[]) {
  return {
    endDate: dateFrom(fd, 'endDate', 'last working day', errors),
    endReason: text(fd, 'endReason'),
    endNote: text(fd, 'endNote'),
  };
}

/** Hires someone: a new current employment (the API refuses one while another is current, or one overlapping the history). */
export async function addEmployment(employeeId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = employmentBody(fd, errors, true);
  return save(employeeId, fd, errors, () => apiSend('POST', `/employees/${employeeId}/employments`, body));
}

/** Changes an employment. `ended`: one in the history, whose end date, reason and note can be corrected too. */
export async function updateEmployment(employeeId: string, employmentId: string, ended: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = { ...employmentBody(fd, errors, !ended), ...(ended && endBody(fd, errors)) };
  return save(employeeId, fd, errors, () => apiSend('PATCH', `/employees/${employeeId}/employments/${employmentId}`, body));
}

/** Ends the current employment. The profile stays: the person is then a former employee, with this employment in their history. */
export async function endEmployment(employeeId: string, employmentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = endBody(fd, errors);
  return save(employeeId, fd, errors, () => apiSend('POST', `/employees/${employeeId}/employments/${employmentId}/end`, body));
}

/** Deletes an employment added by mistake (a Super Admin only); the profile shows the change in place. */
export async function deleteEmployment(employeeId: string, employmentId: string): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', `/employees/${employeeId}/employments/${employmentId}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  refresh();
  return {};
}
