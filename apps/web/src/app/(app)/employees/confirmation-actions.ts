'use server';

// The employee's own check of their details, and their requests to change them (owner's decision, 15 October 2026).
// Each action forwards to the API, which lets only the employee themself confirm, ask or cancel, so calling these
// directly can't bypass that. HR's and Admin's decisions on the requests are in approvals/actions.ts.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { fieldTexts, parseFieldTexts, requestedChanges } from './confirmation';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/** The submitted values, so the form can be refilled after an error (not the starting values sent with it). */
function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd) if (typeof value === 'string' && key !== 'start' && !key.startsWith('$ACTION')) out[key] = value;
  return out;
}

/**
 * Confirm my details: the employee accepts the statement (`accept`, the version they read in `disclaimerVersion`).
 * The API refuses (409) when the statement changed since the page was opened. Back to the profile, thanked; the review
 * at sign-in lets them through from then on, hence the refresh (31 October 2026).
 */
export async function confirmDetails(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = submitted(fd);
  if (fd.get('accept') !== 'on') return { errors: ['Tick "I have read and accept this statement" to confirm your details.'], values };
  const disclaimerVersion = Number(text(fd, 'disclaimerVersion'));

  try {
    await apiSend('POST', `/employees/${encodeURIComponent(id)}/confirm`, { accept: true, disclaimerVersion });
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  refresh();
  redirect(`/employees/${id}?confirmed=1`);
}

/**
 * Asks HR to change some details. The form sends every field and, as `start`, the fields as it first showed them; only
 * the fields changed since are sent, with the employee's note. The API checks them as it checks HR's edits (and says
 * so when nothing would change, or when a request is already waiting). Back to the page, which then lists it.
 */
export async function requestChange(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = submitted(fd);
  const note = text(fd, 'note').trim();
  const start = parseFieldTexts(fd.get('start'));
  // only sent once the page has loaded (the phone and list fields need it too)
  if (!start) return { errors: ['The page had not finished loading. Please send the request again.'], values };

  const { changes, errors } = requestedChanges(start, fieldTexts(fd));
  if (Object.keys(changes).length === 0 && errors.length === 0) {
    errors.push('Nothing would change: correct the details that are wrong, then send the request.');
  }
  if (!note) errors.push('Write what should change and why.');
  if (errors.length) return { errors, values };

  try {
    await apiSend('POST', `/employees/${encodeURIComponent(id)}/change-requests`, { changes, note });
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  // a change asked for lets them past the review at sign-in while HR decides (31 October 2026): the layout reads again
  refresh();
  redirect(`/employees/${id}/change-request?sent=1`);
}

/** Withdraws the employee's request while it waits for HR. Back to the page; the review at sign-in may wait again. */
export async function cancelChangeRequest(employeeId: string, requestId: string): Promise<FormState> {
  try {
    await apiSend('POST', `/change-requests/${encodeURIComponent(requestId)}/cancel`, {});
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  redirect(`/employees/${employeeId}/change-request?cancelled=1`);
}
