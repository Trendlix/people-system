'use server';

// Contract and ending actions on the profile's Employment tab: drafting a contract or its renewal, signing it, its
// filing dates; confirming probation; recording an ending (HR, which counts as HR's approval), the CEO's decision on
// it, withdrawing and completing it. Each one forwards to the API, which checks the session and the role (HR; the
// CEO for the decision; a Super Admin for deleting a draft or undoing a signing), so calling these directly can't
// bypass permissions. Dates are typed as DD/MM/YYYY and sent as YYYY-MM-DD.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { contractBody, conversionBody } from './contract-body';
import { contractHref, profileHref } from './ui';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

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

/** An API from before contracts and endings (October 2026) answers "Cannot POST /api/…" for their addresses. */
function messagesOf(err: ApiError): string[] {
  if (err.status === 404 && err.messages.some((m) => /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(m))) {
    return ['Not available yet: the server does not have contracts and endings yet. Please try again after its next update.'];
  }
  return asShown(err.messages);
}

/**
 * Sends the request unless reading the form already found mistakes, then goes back to the profile's Employment tab: at
 * the top (an ending), or at the contract (`to`: contractHref, #contract).
 */
async function save(employeeId: string, fd: FormData, errors: string[], request: () => Promise<unknown>, to = profileHref(employeeId, 'employment')): Promise<FormState> {
  if (errors.length) return { errors, values: submitted(fd) };
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err), values: submitted(fd) };
    throw err;
  }
  redirect(to);
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

/** A required DD/MM/YYYY date. */
function requiredDate(fd: FormData, key: string, label: string, errors: string[]): string {
  const raw = text(fd, key);
  if (raw === '') {
    errors.push(`Enter the ${label}, e.g. 14/10/2026.`);
    return '';
  }
  return dateFrom(fd, key, label, errors);
}

/** Drafts the employment's first contract, or the renewal of its signed one (one draft at a time). */
export async function createContract(employeeId: string, employmentId: string, renewal: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = contractBody(fd, errors, renewal, false);
  return save(employeeId, fd, errors, () => apiSend('POST', `/employees/${employeeId}/employments/${employmentId}/contracts`, body), contractHref(employeeId));
}

/**
 * Drafts the full-time contract an intern's agreement converts to (owner, 19 October 2026: "after that it should be
 * converted to a full time contract"), as the employment's next version; signing it makes the employment full-time.
 */
export async function convertToFullTime(employeeId: string, employmentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = conversionBody(fd, errors);
  return save(employeeId, fd, errors, () => apiSend('POST', `/employees/${employeeId}/employments/${employmentId}/contracts`, body), contractHref(employeeId));
}

/** Changes a draft (a signed version is changed only in its filing dates and note: see `updateSignedContract`). */
export async function updateContract(employeeId: string, contractId: string, renewal: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = contractBody(fd, errors, renewal, true);
  return save(employeeId, fd, errors, () => apiSend('PATCH', `/contracts/${contractId}`, body), contractHref(employeeId));
}

/** Deletes a draft: a Super Admin only (owner's decision, 15 October 2026). */
export async function deleteContract(contractId: string): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return act(() => apiSend('DELETE', `/contracts/${contractId}`), 'Draft deleted.');
}

/**
 * Records that a draft was signed, on the day typed. Version 1 sets the employment's probation end and status; a
 * renewal replaces the version before it.
 */
export async function signContract(contractId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const signedOn = requiredDate(fd, 'signedOn', 'date it was signed', errors);
  if (errors.length) return { errors, values: submitted(fd) };
  return act(() => apiSend('POST', `/contracts/${contractId}/sign`, { signedOn }), 'Signed.', fd);
}

/**
 * Undoes a signing recorded by mistake: the contract is a draft again, and what signing did is undone. A Super Admin
 * only (owner's decision, 15 October 2026); the API refuses it once a signed copy of its documents is uploaded.
 */
export async function unsignContract(contractId: string): Promise<FormState> {
  return act(() => apiSend('POST', `/contracts/${contractId}/unsign`), 'Signing undone.');
}

/** A signed version's dates (signed, filed with the insurance office and the labour office) and its note. */
export async function updateSignedContract(contractId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = {
    signedOn: requiredDate(fd, 'signedOn', 'date it was signed', errors),
    insuranceFiledOn: dateFrom(fd, 'insuranceFiledOn', 'date it was filed with the insurance office', errors),
    labourOfficeFiledOn: dateFrom(fd, 'labourOfficeFiledOn', 'date it was filed with the labour office', errors),
    note: text(fd, 'note'),
  };
  if (errors.length) return { errors, values: submitted(fd) };
  return act(() => apiSend('PATCH', `/contracts/${contractId}`, body), 'Saved.', fd);
}

/** Probation passed: the employment's status becomes Active. */
export async function confirmProbation(employeeId: string, employmentId: string): Promise<FormState> {
  return act(() => apiSend('POST', `/employees/${employeeId}/employments/${employmentId}/confirm-probation`), 'Probation confirmed.');
}

/**
 * Records how the current employment is to end, for the CEO's approval: HR recording it counts as HR's approval.
 * The certification at the labour office is sent for a resignation only (Decree 187/2025).
 */
export async function startEnding(employeeId: string, employmentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const ruleKey = text(fd, 'ruleKey');
  if (!ruleKey) errors.push('Choose how the employment ends.');
  const noticeGivenOn = requiredDate(fd, 'noticeGivenOn', 'notice date', errors);
  const initiator = text(fd, 'initiator');
  const resignation = ruleKey === 'resignation';
  const body = {
    ruleKey,
    ...(initiator && { initiator }),
    noticeGivenOn,
    payInLieu: fd.get('payInLieu') === 'yes',
    ...(resignation && {
      certifiedOffice: text(fd, 'certifiedOffice'),
      certifiedSerial: text(fd, 'certifiedSerial'),
      certifiedOn: requiredDate(fd, 'certifiedOn', 'certification date', errors),
    }),
    reason: text(fd, 'reason'),
    note: text(fd, 'note'),
  };
  return save(employeeId, fd, errors, () => apiSend('POST', `/employees/${employeeId}/employments/${employmentId}/endings`, body));
}

/** The CEO approves an ending (with an optional note) or rejects it (with a note saying why). */
export async function decideEnding(endingId: string, decision: 'approve' | 'reject', _prev: FormState, fd: FormData): Promise<FormState> {
  const note = text(fd, 'note');
  if (decision === 'reject' && !note) return { errors: ['Write why the ending is rejected.'], values: submitted(fd) };
  return act(
    () => apiSend('POST', `/endings/${endingId}/${decision}`, decision === 'reject' || note ? { note } : {}),
    decision === 'approve' ? 'Approved.' : 'Rejected.',
    fd,
  );
}

/** HR withdraws an ending that is waiting for the CEO or approved, e.g. the employee withdrew the resignation. */
export async function withdrawEnding(endingId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const note = text(fd, 'note');
  return act(() => apiSend('POST', `/endings/${endingId}/withdraw`, note ? { note } : {}), 'Withdrawn.', fd);
}

/** HR completes an approved ending on or after the last working day, which ends the employment. */
export async function completeEnding(endingId: string): Promise<FormState> {
  return act(() => apiSend('POST', `/endings/${endingId}/complete`), 'Completed.');
}
