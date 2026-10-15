'use server';

// Contract and ending actions on the profile's Contracts and Employment tabs: drafting a contract or its renewal, signing it, its
// filing dates; confirming probation; recording an ending (HR, which counts as HR's approval), the CEO's decision on
// it, withdrawing and completing it. Each one forwards to the API, which checks the session and the role (HR; the
// CEO for the decision; a Super Admin for deleting a draft or undoing a signing), so calling these directly can't
// bypass permissions. Dates are typed as DD/MM/YYYY and sent as YYYY-MM-DD.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { PayBasis } from '@trendlix/shared';
import { allowancesFrom } from '@/lib/allowances';
import { ApiError, apiSend } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { MAX_HOURS_PER_WEEK, parseAmount, parseHours } from './[id]/contracts/salary';
import { profileHref, type ProfileTabKey } from './ui';

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
 * Sends the request unless reading the form already found mistakes, then goes back to the profile: its Employment tab
 * (an ending), or its Contracts tab (a contract).
 */
async function save(employeeId: string, fd: FormData, errors: string[], request: () => Promise<unknown>, tab: ProfileTabKey = 'employment'): Promise<FormState> {
  if (errors.length) return { errors, values: submitted(fd) };
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err), values: submitted(fd) };
    throw err;
  }
  redirect(profileHref(employeeId, tab));
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

/** A whole number of months, within limits; "" → undefined (the API's default). */
function monthsFrom(fd: FormData, key: string, label: string, max: number, errors: string[]): number | undefined {
  const raw = text(fd, key);
  if (raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    errors.push(`Enter the ${label} as a whole number of months, from 0 to ${max}.`);
    return undefined;
  }
  return n;
}

/** An amount in EGP; "" → null (a mistake when `required`). */
function amountFrom(fd: FormData, key: string, label: string, errors: string[], required = false, example = '15,000'): number | null {
  const n = parseAmount(text(fd, key));
  if (n === null) {
    if (required) errors.push(`Enter the ${label}, e.g. ${example}.`);
    return null;
  }
  if (Number.isNaN(n) || (required && n <= 0)) {
    errors.push(`Enter the ${label} as an amount in EGP${required ? ' above 0' : ''}, e.g. ${example}.`);
    return null;
  }
  return n;
}

/** By the hour: the contracted hours a week, required, above 0 and up to 48 (half hours as 22.5). */
function hoursFrom(fd: FormData, errors: string[]): number | null {
  const n = parseHours(text(fd, 'hoursPerWeek'));
  if (n === null || Number.isNaN(n) || n <= 0 || n > MAX_HOURS_PER_WEEK) {
    errors.push(`Enter the hours a week as a number above 0, up to ${MAX_HOURS_PER_WEEK}, e.g. 20 or 22.5.`);
    return null;
  }
  return n;
}

/** The working days a week, 1 to 6; "" → null (the shift's week). */
function daysFrom(fd: FormData, errors: string[]): number | null {
  const raw = text(fd, 'daysPerWeek');
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 6) {
    errors.push("Enter the working days a week as a whole number from 1 to 6, or leave it empty for the shift's week.");
    return null;
  }
  return n;
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

/**
 * The contract form's fields (contracts/contract-form.tsx). A renewal has no start date or probation to send: it
 * starts the day after the previous version ends, without probation. Every contract runs for a fixed term (owner, 15
 * October 2026), so the length is always sent and the form (always fixed) isn't. The pay (owner's requests of the same
 * day) is a monthly salary, its gross, or by the hour, the rate and the hours a week, from which the API works out the
 * gross (the monthly estimate); then the working days a week, and the allowances, which replace the contract's set.
 * `draft`: changing a draft, where an emptied net or number of working days is cleared (null); a new contract just
 * leaves them out.
 */
function contractBody(fd: FormData, errors: string[], renewal: boolean, draft: boolean) {
  const startDate = renewal ? '' : dateFrom(fd, 'startDate', 'start date', errors);
  const durationMonths = monthsFrom(fd, 'durationMonths', 'length', 60, errors);
  if (durationMonths === 0) errors.push('A fixed term runs for 1 to 60 months.');
  const probationMonths = renewal ? undefined : monthsFrom(fd, 'probationMonths', 'probation', 3, errors);
  const payBasis: PayBasis = text(fd, 'payBasis') === 'hourly' ? 'hourly' : 'monthly';
  const pay =
    payBasis === 'hourly'
      ? { hourlyRate: amountFrom(fd, 'hourlyRate', 'hourly rate', errors, true, '150'), hoursPerWeek: hoursFrom(fd, errors) }
      : { grossSalary: amountFrom(fd, 'grossSalary', 'gross salary', errors, true) };
  const daysPerWeek = daysFrom(fd, errors);
  const basicRaw = text(fd, 'basicPercent');
  const basicPercent = basicRaw === '' ? undefined : Number(basicRaw);
  if (basicPercent !== undefined && !(Number.isInteger(basicPercent) && basicPercent >= 1 && basicPercent <= 100)) {
    errors.push('Enter the basic part as a whole percent of the gross, from 1 to 100, e.g. 80.');
  }
  const netSalary = amountFrom(fd, 'netSalary', 'net salary', errors);
  return {
    ...(startDate && { startDate }),
    ...(durationMonths !== undefined && { durationMonths }),
    ...(probationMonths !== undefined && { probationMonths }),
    payBasis,
    ...pay,
    ...(daysPerWeek !== null ? { daysPerWeek } : draft ? { daysPerWeek: null } : {}),
    ...(basicPercent !== undefined && { basicPercent }),
    ...(netSalary !== null ? { netSalary } : draft ? { netSalary: null } : {}),
    allowances: allowancesFrom(fd, errors),
    note: text(fd, 'note'),
  };
}

/** Drafts the employment's first contract, or the renewal of its signed one (one draft at a time). */
export async function createContract(employeeId: string, employmentId: string, renewal: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = contractBody(fd, errors, renewal, false);
  return save(employeeId, fd, errors, () => apiSend('POST', `/employees/${employeeId}/employments/${employmentId}/contracts`, body), 'contracts');
}

/** Changes a draft (a signed version is changed only in its filing dates and note: see `updateSignedContract`). */
export async function updateContract(employeeId: string, contractId: string, renewal: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = contractBody(fd, errors, renewal, true);
  return save(employeeId, fd, errors, () => apiSend('PATCH', `/contracts/${contractId}`, body), 'contracts');
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
