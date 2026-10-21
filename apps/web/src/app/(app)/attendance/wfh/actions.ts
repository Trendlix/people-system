'use server';

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"):
// asking for a day (the employee's own), HR recording one for someone (approved at once, with a reason, past the notice
// and the limits with warnings), what such a day would meet (for HR's form, live), the employee cancelling theirs while
// it is being decided, HR cancelling an approved one with a comment, each approver's decision (approve, or reject with a
// comment), and the Leave Setup's two limits. Each forwards to the API, which checks the day, the notice, the limits,
// who decides each stage and that nobody decides their own, so calling these directly can't bypass that. Once sent, the
// request's page opens: the site's, or the phone pages' for a form sent from them (lib/surface.ts).
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { LeaveStage } from '@trendlix/shared';
import { ApiError, apiFetch, apiSend, messagesOf } from '@/lib/api';
import { afterAction } from '@/lib/surface';
import type { FormState } from '@/lib/types';
import type { WfhCheck, WfhRequestView, WfhSettings } from '@/lib/wfh-types';
import { leaveDecisionBody } from '../../leave/list';
import { shownMessage } from '../../leave/permissions';
import { MY_WFH_HREF, WFH_PATH, wfhCancelBody, wfhDoneHref, wfhForm, wfhRecordForm, typedWfhValues } from './wfh';

const shown = (messages: string[]) => messages.map(shownMessage);

/** The employee asks to work from home on a day (POST /me/wfh); refused with every reason, kept with what was typed. */
export async function sendWfh(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedWfhValues(fd);
  const { body, errors } = wfhForm(fd);
  if (!body) return { errors, values };
  let made: WfhRequestView | undefined;
  try {
    made = await apiSend<WfhRequestView>('POST', '/me/wfh', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // My Requests, the approver's count in the sidebar and the month's days now have it
  refresh();
  redirect(afterAction(fd, made?.id ? wfhDoneHref(made.id, 'sent') : MY_WFH_HREF));
}

/** HR records a day for someone (POST /wfh, with the employee and the reason): approved at once. */
export async function recordWfh(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedWfhValues(fd);
  const { body, errors } = wfhRecordForm(fd);
  if (!body) return { errors, values };
  let made: WfhRequestView | undefined;
  try {
    made = await apiSend<WfhRequestView>('POST', '/wfh', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(made?.id ? wfhDoneHref(made.id, 'recorded') : WFH_PATH);
}

/**
 * What HR recording a day for someone would meet (GET /wfh/check): what refuses it and what it would be recorded past,
 * for the form to show as the day is chosen.
 */
export async function checkWfhDay(employeeId: string, date: string): Promise<{ check: WfhCheck } | { errors: string[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employeeId) return { errors: [] };
  let res: Response;
  try {
    res = await apiFetch(`/wfh/check?employeeId=${encodeURIComponent(employeeId)}&date=${date}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (!res.ok) return { errors: shown(await messagesOf(res)) };
  try {
    const check = (await res.json()) as WfhCheck;
    return { check: { ...check, problems: shown(check.problems), warnings: shown(check.warnings) } };
  } catch {
    return { errors: ['The server sent an answer that could not be read.'] };
  }
}

/** The employee cancels their request while it is being decided (POST /me/wfh/:id/cancel). `fd`: where it was sent from. */
export async function cancelMyWfh(id: string, _prev?: FormState, fd?: FormData): Promise<FormState> {
  try {
    await apiSend('POST', `/me/wfh/${encodeURIComponent(id)}/cancel`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, wfhDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, wfhDoneHref(id, 'cancelled')));
}

/** HR cancels an approved day (POST /wfh/:id/cancel), with a comment the employee sees. */
export async function cancelWfhByHr(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { comment: String(fd.get('comment') ?? '') };
  const { body, errors } = wfhCancelBody(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/wfh/${encodeURIComponent(id)}/cancel`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, wfhDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, wfhDoneHref(id, 'cancelled')));
}

/**
 * An approver's decision on a request waiting for them (POST /wfh/:id/decide): approve, or reject with a comment. One that
 * moved on meanwhile is refused (409): the page then shows where it stands, and says so.
 */
export async function decideWfh(id: string, stage: LeaveStage, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { decision: String(fd.get('decision') ?? ''), comment: String(fd.get('comment') ?? '') };
  const { body, errors } = leaveDecisionBody(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/wfh/${encodeURIComponent(id)}/decide`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, wfhDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // the lists and the counts in the sidebar change with it
  refresh();
  redirect(afterAction(fd, wfhDoneHref(id, `${stage}_${body.decision}`)));
}

/** The Leave Setup's limits (PATCH /wfh/settings): the days a month and the days between two, whole numbers. */
export async function saveWfhSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = { daysPerMonth: String(fd.get('daysPerMonth') ?? ''), minGapDays: String(fd.get('minGapDays') ?? '') };
  const whole = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null);
  const daysPerMonth = whole(values.daysPerMonth);
  const minGapDays = whole(values.minGapDays);
  const errors: string[] = [];
  if (daysPerMonth === null) errors.push('Enter the work from home days a month as a whole number, e.g. 2 (0: no working from home).');
  if (minGapDays === null) errors.push('Enter the days between two work from home days as a whole number, e.g. 7.');
  if (errors.length) return { errors, values };
  try {
    await apiSend<WfhSettings>('PATCH', '/wfh/settings', { daysPerMonth, minGapDays });
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  return { message: 'Work from home limits saved.', values };
}
