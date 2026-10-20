'use server';

// Permission requests (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours
// per day", asked "In the system, like leave"): sending one (JSON: no documents), HR recording one on an employee's
// behalf (approved at once), reading a month's hours again for a day the form moved into another month, cancelling one
// (the employee while it is being decided or before its day; HR an approved one, with a comment, its hours given back)
// and each approver's decision (approve, or reject with a comment). Each forwards to the API, which checks the Leave
// Setup's hours, the day (a rest day, an official holiday, a day of leave), who decides each stage and that nobody decides
// their own, so calling these directly can't bypass that. Once sent, the request's page opens: the site's, or the phone
// pages' for a form sent from them (owner, 20 October 2026: the employee app; lib/surface.ts).
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { LeaveStage } from '@trendlix/shared';
import { ApiError, apiFetch, apiSend, messagesOf } from '@/lib/api';
import { afterAction } from '@/lib/surface';
import type { EmployeePermissionMonth, FormState, PermissionMonthView, PermissionRequestView } from '@/lib/types';
import { hrCancelBody, leaveDecisionBody } from './list';
import { permissionDoneHref, permissionForm, shownMessage, typedPermissionValues } from './permissions';

const shown = (messages: string[]) => messages.map(shownMessage);

/**
 * An employee's request for themself (POST /me/permissions). What the API finds wrong (the day's or the month's hours,
 * a rest day, an official holiday, a day of leave) comes back as the form's errors, with what was typed; once sent, its
 * page opens, saying where it goes.
 */
export async function sendPermission(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedPermissionValues(fd);
  const { body, errors } = permissionForm(fd);
  if (!body) return { errors, values };
  let request: PermissionRequestView | undefined;
  try {
    request = await apiSend<PermissionRequestView>('POST', '/me/permissions', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // My Requests, the month's hours and the manager's count in the sidebar now have it
  refresh();
  redirect(afterAction(fd, request?.id ? permissionDoneHref(request.id, 'sent') : '/my-requests'));
}

/** HR records permission on an employee's behalf (POST /leave/permissions, with the employee), approved at once. */
export async function recordPermission(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedPermissionValues(fd);
  const employeeId = String(fd.get('employeeId') ?? '').trim();
  const { body, errors } = permissionForm(fd);
  if (!employeeId) errors.unshift('Choose the employee the permission is for.');
  if (!body || !employeeId) return { errors, values };
  let request: PermissionRequestView | undefined;
  try {
    request = await apiSend<PermissionRequestView>('POST', '/leave/permissions', { employeeId, ...body });
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(request?.id ? permissionDoneHref(request.id, 'recorded') : '/leave?kind=permission');
}

/**
 * A month's permission hours again ("YYYY-MM"), for a day the form moved into another month: the employee's own (GET
 * /me/permissions/allowance), or, for HR recording on someone's behalf, theirs (GET /employees/:id/permissions).
 */
export async function permissionMonthData(month: string, employeeId: string | null): Promise<{ month: PermissionMonthView } | { errors: string[] }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { errors: ['Enter a day as DD/MM/YYYY.'] };
  const path = employeeId
    ? `/employees/${encodeURIComponent(employeeId)}/permissions?month=${month}`
    : `/me/permissions/allowance?month=${month}`;
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (!res.ok) return { errors: shown(await messagesOf(res)) };
  try {
    // HR's read has the person's requests too: the form needs only the figures
    const value = (await res.json()) as PermissionMonthView | EmployeePermissionMonth;
    return { month: { month: value.month, hoursPerMonth: value.hoursPerMonth, maxHoursPerDay: value.maxHoursPerDay, approved: value.approved, pending: value.pending, left: value.left, days: value.days } };
  } catch {
    return { errors: ['The server sent an answer that could not be read.'] };
  }
}

/**
 * The employee cancels their request (POST /me/permissions/:id/cancel): while it is being decided, or before its day.
 * `fd`: the form's, which says where it was sent from.
 */
export async function cancelMyPermission(requestId: string, _prev?: FormState, fd?: FormData): Promise<FormState> {
  try {
    await apiSend('POST', `/me/permissions/${encodeURIComponent(requestId)}/cancel`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, permissionDoneHref(requestId, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, permissionDoneHref(requestId, 'cancelled')));
}

/** HR cancels an approved request (POST /leave/permissions/:id/cancel), with a comment; its hours are given back. */
export async function cancelPermissionByHr(requestId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { comment: String(fd.get('comment') ?? '') };
  const { body, errors } = hrCancelBody(fd, 'permission');
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/leave/permissions/${encodeURIComponent(requestId)}/cancel`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, permissionDoneHref(requestId, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, permissionDoneHref(requestId, 'cancelled')));
}

/**
 * An approver's decision on a request waiting for them (POST /leave/permissions/:id/decide): approve it, or reject it
 * with a comment. `stage`: whose decision it is, for what the page says after it. A request that moved on meanwhile is
 * refused (409): the page then shows where it stands, and says so.
 */
export async function decidePermission(requestId: string, stage: LeaveStage, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { decision: String(fd.get('decision') ?? ''), comment: String(fd.get('comment') ?? '') };
  const { body, errors } = leaveDecisionBody(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/leave/permissions/${encodeURIComponent(requestId)}/decide`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, permissionDoneHref(requestId, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // the lists and the counts in the sidebar change with it
  refresh();
  redirect(afterAction(fd, permissionDoneHref(requestId, `${stage}_${body.decision}`)));
}
