'use server';

// An employee's resignation request (owner, 26 October 2026: "but the employee has to request resignation and then the HR
// generates the document"): sending it, withdrawing it, HR returning it with a reason, HR recording it as the ending the
// End employment form makes, and HR uploading its signed letter (owner, 31 October 2026: "on the resignation, the letter
// is auto generated, viewed by the employee but uploaded by the HR"). Each forwards to the API, which checks who may, so
// calling these directly can't bypass that.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import type { FormState } from '@/lib/types';
import type { ResignationRequestView } from '@/lib/resignation-types';
import { profileHref } from '../employees/ui';
import { PAPERWORK_MAX_BYTES, TOO_LARGE } from '../employees/paperwork';
import { MY_RESIGNATION_HREF, resignationHref } from './resignation';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** The submitted values, so the form can be refilled after an error. */
function submitted(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith('$ACTION') || key === 'file') continue;
    const all = fd.getAll(key).filter((v) => typeof v === 'string');
    if (all.length > 0) out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/** The employee sends the request (POST /me/resignation): refused with every reason, kept with what was typed. No letter: People prepares it. */
export async function sendResignation(_prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const preferred = text(fd, 'preferredLastDay') === '' ? '' : dateFrom(fd, 'preferredLastDay', 'preferred last working day', errors);
  if (errors.length) return { errors, values: submitted(fd) };
  const body = { reason: text(fd, 'reason'), preferredLastDay: preferred, confirmed: fd.get('confirmed') === 'yes' };
  let made: ResignationRequestView | undefined;
  try {
    made = await apiSend<ResignationRequestView>('POST', '/me/resignation', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values: submitted(fd) };
    throw err;
  }
  refresh();
  redirect(made?.id ? resignationHref(made.id, 'sent') : MY_RESIGNATION_HREF);
}

/** The employee withdraws their request while it waits for HR (POST /me/resignation/:id/withdraw). */
export async function withdrawResignation(id: string): Promise<FormState> {
  try {
    await apiSend('POST', `/me/resignation/${encodeURIComponent(id)}/withdraw`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(resignationHref(id, 'moved'));
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  refresh();
  redirect(resignationHref(id, 'withdrawn'));
}

/** HR returns a mistaken request with a reason the employee sees (POST /resignation-requests/:id/return). */
export async function returnResignation(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const reason = text(fd, 'reason');
  if (!reason) return { errors: ['Enter why the request is returned.'], values: submitted(fd) };
  try {
    await apiSend('POST', `/resignation-requests/${encodeURIComponent(id)}/return`, { reason });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(resignationHref(id, 'moved'));
    if (err instanceof ApiError) return { errors: asShown(err.messages), values: submitted(fd) };
    throw err;
  }
  refresh();
  redirect(resignationHref(id, 'returned'));
}

/**
 * "Record the resignation": the End employment form's fields for a resignation, sent to the request's own address so the
 * ending is made and linked in one step (POST /resignation-requests/:id/record). Then the profile's Employment tab, as
 * recording an ending goes.
 */
export async function recordResignation(requestId: string, employeeId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const noticeGivenOn = text(fd, 'noticeGivenOn') === '' ? (errors.push('Enter the notice date, e.g. 14/10/2026.'), '') : dateFrom(fd, 'noticeGivenOn', 'notice date', errors);
  const certifiedOn = text(fd, 'certifiedOn') === '' ? (errors.push('Enter the certification date, e.g. 14/10/2026.'), '') : dateFrom(fd, 'certifiedOn', 'certification date', errors);
  if (errors.length) return { errors, values: submitted(fd) };
  // HR's agreed last working day, empty to use the notice's: the employee's preferred day to start with (26 October 2026)
  const agreed = fd.has('agreedLastWorkingDay') && text(fd, 'agreedLastWorkingDay') !== '' ? dateFrom(fd, 'agreedLastWorkingDay', 'agreed last working day', errors) : null;
  if (errors.length) return { errors, values: submitted(fd) };
  const body = {
    ruleKey: 'resignation',
    noticeGivenOn,
    payInLieu: fd.get('payInLieu') === 'yes',
    certifiedOffice: text(fd, 'certifiedOffice'),
    certifiedSerial: text(fd, 'certifiedSerial'),
    certifiedOn,
    reason: text(fd, 'reason'),
    note: text(fd, 'note'),
    ...(agreed && { agreedLastWorkingDay: agreed }),
  };
  try {
    await apiSend('POST', `/resignation-requests/${encodeURIComponent(requestId)}/record`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values: submitted(fd) };
    throw err;
  }
  refresh();
  redirect(profileHref(employeeId, 'employment'));
}

/**
 * HR uploads the signed letter the employee handed in, or replaces it (POST /resignation-requests/:id/letter): a photo
 * (made smaller in the browser first) or a PDF, checked again by the API by its content.
 */
export async function uploadResignationLetter(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const value = fd.get('file');
  const file = value instanceof File && value.size > 0 ? value : null;
  if (!file) return { errors: ['Choose the signed letter: a photo or a PDF scan.'] };
  if (file.size > PAPERWORK_MAX_BYTES) return { errors: [TOO_LARGE] };
  const form = new FormData();
  form.append('letter', file, file.name);
  try {
    await apiUpload('POST', `/resignation-requests/${encodeURIComponent(id)}/letter`, form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  refresh();
  return { message: 'Signed letter uploaded.' };
}
