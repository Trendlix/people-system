'use server';

// Pay raises on the profile's Employment tab (owner's decisions, 16 October 2026: "HR, then the CEO"): HR enters a
// raise on the signed contract in force (an amendment or a new contract; from a raise request it is HR's approval of
// it, with HR's comment, sent to the CEO at once), changes it, sends it to the CEO, and records the Form 2 filed once
// it is approved; the CEO approves it as it is or with another raise, or rejects it (the draft is deleted), always with
// a comment, or returns it to HR (17 October 2026). A renewal with new pay is sent, decided and returned the same way. Each one forwards to the API, which checks the session and the role (HR; the CEO for the
// decisions), so calling these directly can't bypass permissions. Dates are typed as DD/MM/YYYY and sent as
// YYYY-MM-DD, and the API's dates are shown as DD/MM/YYYY.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { ceoDecisionBody } from '../raise-requests/decisions';
import { form2Body, raiseBody } from './[id]/contracts/raise';
import { contractHref } from './ui';

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

/** An API from before raises (16 October 2026) answers "Cannot POST /api/…" for their addresses. */
function messagesOf(err: ApiError): string[] {
  if (err.status === 404 && err.messages.some((m) => /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(m))) {
    return ['Not available yet: the server does not have pay raises yet. Please try again after its next update.'];
  }
  return asShown(err.messages);
}

/** Sends the raise form unless reading it found mistakes, then goes back to the contract on the Employment tab. */
async function save(employeeId: string, fd: FormData, errors: string[], request: () => Promise<unknown>): Promise<FormState> {
  if (errors.length) return { errors, values: submitted(fd) };
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err), values: submitted(fd) };
    throw err;
  }
  redirect(contractHref(employeeId));
}

/** Sends the request and shows the change in place (the profile is rendered again); `message` closes a small form. */
async function act(request: () => Promise<unknown>, message: string, fd?: FormData): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err), values: fd && submitted(fd) };
    throw err;
  }
  refresh();
  return { message };
}

/** HR enters a raise on the employment's signed contract in force: a draft, one at a time, to send to the CEO. */
export async function createRaise(employeeId: string, employmentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = raiseBody(fd, errors, false);
  return save(employeeId, fd, errors, () => apiSend('POST', `/employees/${employeeId}/employments/${employmentId}/raises`, body));
}

/** HR changes a raise not with the CEO; an approved one changed goes back to HR, to send to the CEO again. */
export async function updateRaise(employeeId: string, raiseId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = raiseBody(fd, errors, true);
  return save(employeeId, fd, errors, () => apiSend('PATCH', `/raises/${raiseId}`, body));
}

/** HR sends a raise (or a renewal with new pay) to the CEO: a draft, or one returned and changed since. */
export async function sendRaise(raiseId: string): Promise<FormState> {
  return act(() => apiSend('POST', `/raises/${raiseId}/send`), 'Sent to the CEO.');
}

/**
 * The CEO's decision on it, with a comment (owner, 17 October 2026: "Approve - Approve with another raise amount or
 * percentge - Reject, and add a comment"): approve it as it is, or with another raise (its pay changed to it), which HR
 * then signs; reject it, which deletes the draft and rejects a raise request it was prepared from; or return it to HR.
 */
export async function ceoDecidesRaise(raiseId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const { choice, path, body } = ceoDecisionBody(fd, errors);
  if (errors.length || !path) return { errors, values: submitted(fd) };
  const done = choice === 'approve' ? 'Approved.' : choice === 'approve_other' ? 'Approved with your raise.' : choice === 'return' ? 'Returned to HR.' : 'Rejected.';
  return act(() => apiSend('POST', `/raises/${raiseId}/${path}`, body), done, fd);
}

/**
 * HR records the Form 2 filed for an approved raise (owner's decision, 16 October 2026: "From the next January unless
 * amended in Form 2"): the insured wage follows the new pay from that 1st of a month (`effective`: the raise's
 * effective date, YYYY-MM-DD, to check it against); left empty, none was filed after all.
 */
export async function recordForm2(raiseId: string, effective: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = form2Body(fd, effective, errors);
  if (errors.length) return { errors, values: submitted(fd) };
  return act(() => apiSend('PATCH', `/raises/${raiseId}/form2`, body), body.form2From ? 'Form 2 recorded.' : 'Form 2 cleared.', fd);
}
