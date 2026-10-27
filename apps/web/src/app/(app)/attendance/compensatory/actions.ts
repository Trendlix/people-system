'use server';

// Compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same month. and
// rarely to be compensated in cash"): asking (the employee's own), HR recording one for someone (approved at once, a day
// off or cash, with a reason), what such a request would meet (for HR's form, live), the employee cancelling theirs while
// it is being decided, HR cancelling an approved one with a comment, each approver's decision (HR's: a day off or cash
// instead), and the Compensatory Setup (owner, 27 October 2026: "i need a setup dashboard for the compensatory leaves":
// the cash rate, the hours that earn hours off or a whole day, when the day off is taken). Each forwards to the API,
// which checks the days, the hours, the notice, the locked months, who decides each stage and that nobody decides their
// own, so calling these directly can't bypass that.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { LeaveStage } from '@trendlix/shared';
import { ApiError, apiFetch, apiSend, messagesOf } from '@/lib/api';
import type { CompensatoryCheck, CompensatoryRequestView, CompensatorySettings } from '@/lib/compensatory-types';
import { afterAction } from '@/lib/surface';
import type { FormState } from '@/lib/types';
import { shownMessage } from '../../leave/permissions';
import {
  COMPENSATORY_PATH,
  compensatoryCancelBody,
  compensatoryDecisionBody,
  compensatoryDoneHref,
  compensatoryForm,
  compensatoryRecordForm,
  MY_COMPENSATORY_HREF,
  readCompensatorySetup,
  typedCompensatorySetup,
  typedCompensatoryValues,
} from './compensatory';

const shown = (messages: string[]) => messages.map(shownMessage);

/** The employee asks for a compensatory day (POST /me/compensatory); refused with every reason, kept with what was typed. */
export async function sendCompensatory(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedCompensatoryValues(fd);
  const { body, errors } = compensatoryForm(fd);
  if (!body) return { errors, values };
  let made: CompensatoryRequestView | undefined;
  try {
    made = await apiSend<CompensatoryRequestView>('POST', '/me/compensatory', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, made?.id ? compensatoryDoneHref(made.id, 'sent') : MY_COMPENSATORY_HREF));
}

/** HR records one for someone (POST /compensatory): approved at once, as a day off or cash instead. */
export async function recordCompensatory(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedCompensatoryValues(fd);
  const { body, errors } = compensatoryRecordForm(fd);
  if (!body) return { errors, values };
  let made: CompensatoryRequestView | undefined;
  try {
    made = await apiSend<CompensatoryRequestView>('POST', '/compensatory', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(made?.id ? compensatoryDoneHref(made.id, 'recorded') : COMPENSATORY_PATH);
}

/**
 * What recording one for someone would meet (GET /compensatory/check): what refuses it and what it is recorded past; with
 * the hours of part of a day (27 October 2026), what they earn and cash instead in days' pay for them.
 */
export async function checkCompensatory(employeeId: string, dayWorked: string, dayOff: string | null, hoursWorked: number | null = null): Promise<{ check: CompensatoryCheck } | { errors: string[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayWorked) || !employeeId) return { errors: [] };
  const params = new URLSearchParams({ employeeId, dayWorked });
  if (dayOff && /^\d{4}-\d{2}-\d{2}$/.test(dayOff)) params.set('dayOff', dayOff);
  if (typeof hoursWorked === 'number' && Number.isFinite(hoursWorked)) params.set('hoursWorked', String(hoursWorked));
  let res: Response;
  try {
    res = await apiFetch(`/compensatory/check?${params.toString()}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (!res.ok) return { errors: shown(await messagesOf(res)) };
  try {
    const check = (await res.json()) as CompensatoryCheck;
    return { check: { ...check, problems: shown(check.problems), warnings: shown(check.warnings) } };
  } catch {
    return { errors: ['The server sent an answer that could not be read.'] };
  }
}

/** The employee cancels their request while it is being decided (POST /me/compensatory/:id/cancel). */
export async function cancelMyCompensatory(id: string, _prev?: FormState, fd?: FormData): Promise<FormState> {
  try {
    await apiSend('POST', `/me/compensatory/${encodeURIComponent(id)}/cancel`);
  } catch (err) {
    // one that goes with an official duty is cancelled with it (27 October 2026): its message stays
    if (err instanceof ApiError && err.status === 409 && !err.messages.some((m) => /official duty/i.test(m))) redirect(afterAction(fd, compensatoryDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, compensatoryDoneHref(id, 'cancelled')));
}

/** HR cancels an approved one (POST /compensatory/:id/cancel), with a comment the employee sees. */
export async function cancelCompensatoryByHr(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { comment: String(fd.get('comment') ?? '') };
  const { body, errors } = compensatoryCancelBody(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/compensatory/${encodeURIComponent(id)}/cancel`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && !err.messages.some((m) => /payroll|official duty/i.test(m))) redirect(afterAction(fd, compensatoryDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, compensatoryDoneHref(id, 'cancelled')));
}

/**
 * An approver's decision on a request waiting for them (POST /compensatory/:id/decide): approve, or reject with a comment;
 * HR's approval is a day off (the default) or cash instead, and confirms a day worked with no check-in kept. A refusal that
 * says why (the payroll month locked, the no check-in confirmation) stays on the form; a request that moved on meanwhile
 * shows where it stands.
 */
export async function decideCompensatory(id: string, stage: LeaveStage, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { decision: String(fd.get('decision') ?? ''), comment: String(fd.get('comment') ?? ''), outcome: String(fd.get('outcome') ?? '') };
  const { body, errors } = compensatoryDecisionBody(fd, stage);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/compensatory/${encodeURIComponent(id)}/decide`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && !err.messages.some((m) => /payroll|check-in|day off|already|Confirm|official duty/i.test(m))) redirect(afterAction(fd, compensatoryDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, compensatoryDoneHref(id, `${stage}_${body.decision}`)));
}

/**
 * The Compensatory Setup (PATCH /compensatory/settings; owner, 27 October 2026: "i need a setup dashboard for the
 * compensatory leaves"): the cash rate, the minimum hours to qualify, the most hours off, the hours for a whole day and
 * when the day off is taken (null: the same calendar month), all five, refused with every reason (the shared checks the
 * API makes, in its words), kept with what was typed. HR's alone: the API refuses anyone else.
 */
export async function saveCompensatorySettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const typed = typedCompensatorySetup(fd);
  const values: Record<string, string> = { ...typed };
  const { rules, errors } = readCompensatorySetup(typed);
  if (!rules) return { errors, values };
  try {
    await apiSend<CompensatorySettings>('PATCH', '/compensatory/settings', rules);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  return { message: 'Compensatory Setup saved. Requests already made keep what they earned.', values };
}
