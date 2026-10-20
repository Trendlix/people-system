'use server';

// Leave requests (owner, 18 October 2026: "can you apply the leaves according to the law?"): sending a request with its
// documents (multipart), HR recording one on an employee's behalf (approved at once), reading the balances and holidays
// again for a request in another year, cancelling one (the employee while it is being decided or before it starts; HR an
// approved one, with a comment, the days given back), each approver's decision (approve, or reject with a comment), and
// HR's adjustment of an annual balance. Each forwards to the API, which checks who may ask, the type's rules, the
// balance, an overlap, who decides each stage and that nobody decides their own, so calling these directly can't bypass
// that. Once sent, the request's page opens: the site's, or the phone pages' for a form sent from them (owner, 20 October
// 2026: "what if we tried to build a mobile app for the employees? to enable them to check in and out, and apply for their
// requests"; lib/surface.ts).
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { LeaveStage } from '@trendlix/shared';
import { ApiError, apiFetch, apiSend, apiUpload, messagesOf } from '@/lib/api';
import { afterAction } from '@/lib/surface';
import type { EmployeeLeave, FormState, Holiday, LeaveBalances, LeaveRequestView } from '@/lib/types';
import { adjustmentBody } from './balance';
import { hrCancelBody, leaveDecisionBody, leaveDoneHref } from './list';
import { asShown, leaveForm, typedLeaveValues } from './request';

const shown = (messages: string[]) => messages.map(asShown);

/** The request as the API takes it (multipart): its fields and the documents (photos made smaller in the browser first). */
function multipart(fields: NonNullable<ReturnType<typeof leaveForm>['fields']>, documents: File[], employeeId?: string): FormData {
  const form = new FormData();
  if (employeeId) form.append('employeeId', employeeId);
  form.append('typeId', fields.typeId);
  form.append('startDate', fields.startDate);
  form.append('endDate', fields.endDate);
  form.append('halfDay', String(fields.halfDay));
  if (fields.reason) form.append('reason', fields.reason);
  for (const file of documents) form.append('documents', file, file.name);
  return form;
}

/**
 * An employee's request for themself (POST /me/leave/requests). What the API finds wrong (a rule of the type, the
 * balance, an overlap with another request) comes back as the form's errors, with what was typed; once sent, its page
 * opens, saying where it goes.
 */
export async function sendLeave(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedLeaveValues(fd);
  const { fields, documents, errors } = leaveForm(fd);
  if (!fields) return { errors, values };
  let request: LeaveRequestView | undefined;
  try {
    request = await apiUpload<LeaveRequestView>('POST', '/me/leave/requests', multipart(fields, documents));
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // My Requests, the balances and the manager's count in the sidebar now have it
  refresh();
  redirect(afterAction(fd, request?.id ? leaveDoneHref(request.id, 'sent') : '/my-requests'));
}

/**
 * HR records leave on an employee's behalf (POST /leave/requests, with the employee), approved at once and logged as
 * recorded by HR; no notice is needed (e.g. sick leave reported afterwards).
 */
export async function recordLeave(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedLeaveValues(fd);
  const employeeId = String(fd.get('employeeId') ?? '').trim();
  const { fields, documents, errors } = leaveForm(fd);
  if (!employeeId) errors.unshift('Choose the employee the leave is for.');
  if (!fields || !employeeId) return { errors, values };
  let request: LeaveRequestView | undefined;
  try {
    request = await apiUpload<LeaveRequestView>('POST', '/leave/requests', multipart(fields, documents, employeeId));
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(request?.id ? leaveDoneHref(request.id, 'recorded') : '/leave');
}

async function readJson<T>(path: string): Promise<{ value: T } | { errors: string[] }> {
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
    return { value: (await res.json()) as T };
  } catch {
    return { errors: ['The server sent an answer that could not be read.'] };
  }
}

/**
 * The balances and official holidays of another year, for a request whose first day the form moved into it: the
 * employee's own (GET /me/leave/balances), or, for HR recording on someone's behalf, theirs (GET /employees/:id/leave).
 */
export async function leaveYearData(year: number, employeeId: string | null): Promise<{ balances: LeaveBalances; holidays: Holiday[] } | { errors: string[] }> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { errors: ['Enter a date from 2000 to 2100.'] };
  const [balances, holidays] = await Promise.all([
    employeeId ? readJson<EmployeeLeave>(`/employees/${encodeURIComponent(employeeId)}/leave?year=${year}`) : readJson<LeaveBalances>(`/me/leave/balances?year=${year}`),
    readJson<Holiday[]>(`/payroll/holidays?year=${year}`),
  ]);
  if ('errors' in balances) return balances;
  return { balances: balances.value, holidays: 'value' in holidays ? holidays.value : [] };
}

/**
 * The employee cancels their request (POST /me/leave/requests/:id/cancel): while it is being decided, or before it starts.
 * `fd`: the form's, which says where it was sent from.
 */
export async function cancelMyLeave(requestId: string, _prev?: FormState, fd?: FormData): Promise<FormState> {
  try {
    await apiSend('POST', `/me/leave/requests/${encodeURIComponent(requestId)}/cancel`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, leaveDoneHref(requestId, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, leaveDoneHref(requestId, 'cancelled')));
}

/** HR cancels an approved request (POST /leave/requests/:id/cancel), with a comment; its days are given back. */
export async function cancelLeaveByHr(requestId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { comment: String(fd.get('comment') ?? '') };
  const { body, errors } = hrCancelBody(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/leave/requests/${encodeURIComponent(requestId)}/cancel`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, leaveDoneHref(requestId, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, leaveDoneHref(requestId, 'cancelled')));
}

/**
 * An approver's decision on a request waiting for them (POST /leave/requests/:id/decide): approve it, or reject it with
 * a comment. `stage`: whose decision it is, for what the page says after it. A request that moved on meanwhile (decided
 * by someone else, or cancelled) is refused (409): the page then shows where it stands, and says so.
 */
export async function decideLeave(requestId: string, stage: LeaveStage, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { decision: String(fd.get('decision') ?? ''), comment: String(fd.get('comment') ?? '') };
  const { body, errors } = leaveDecisionBody(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/leave/requests/${encodeURIComponent(requestId)}/decide`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, leaveDoneHref(requestId, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // the lists and the counts in the sidebar change with it
  refresh();
  redirect(afterAction(fd, leaveDoneHref(requestId, `${stage}_${body.decision}`)));
}

/**
 * HR adjusts an employee's annual balance for a year (POST /employees/:id/leave/adjustments): more days, or fewer, with
 * the reason, logged. The profile shows the balance again, with it.
 */
export async function adjustLeaveBalance(employeeId: string, year: number, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { days: String(fd.get('days') ?? ''), reason: String(fd.get('reason') ?? '') };
  const { body, errors } = adjustmentBody(fd, year);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/employees/${encodeURIComponent(employeeId)}/leave/adjustments`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  return { message: `Balance adjusted by ${body.days > 0 ? '+' : ''}${body.days} ${Math.abs(body.days) === 1 ? 'day' : 'days'} for ${year}.` };
}
