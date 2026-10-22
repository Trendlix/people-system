'use server';

// Offboarding (owner, 22 October 2026: the full module): clearing a case's item (its owner, or HR, the CEO, a Super
// Admin), adding a one-off item, completing a case (a Super Admin with items pending, with the reason), rehire
// eligibility, the exit interview recorded by HR or declined, opening a case by hand, the default checklist, and the
// leaver's own exit interview. Each forwards to the API, which checks who may and every rule again.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import type { OffboardingCaseView } from '@trendlix/shared';
import { addItemForm, caseHref, checklistForm, exitInterviewForm, markItemForm, MY_EXIT_INTERVIEW_PATH, OFFBOARDING_CHECKLIST_PATH, rehireForm, typedValues } from './offboarding';

/** Sends a change and refreshes the page; the API's reasons when it refuses. */
async function send(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, values?: Record<string, string>): Promise<FormState> {
  try {
    await apiSend(method, path, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, ...(values && { values }) };
    throw err;
  }
  refresh();
  return { message: 'Saved.' };
}

export async function markItem(caseId: string, itemId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = markItemForm(fd);
  if (!body) return { errors };
  return send('PATCH', `/offboarding/cases/${encodeURIComponent(caseId)}/items/${encodeURIComponent(itemId)}`, body);
}

export async function addItem(caseId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd);
  const { body, errors } = addItemForm(fd);
  if (!body) return { errors, values };
  const done = await send('POST', `/offboarding/cases/${encodeURIComponent(caseId)}/items`, body, values);
  return done.errors ? done : { message: 'Item added.' };
}

export async function completeCase(caseId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const reason = fd.get('overrideReason');
  const overrideReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
  return send('POST', `/offboarding/cases/${encodeURIComponent(caseId)}/complete`, { overrideReason }, typedValues(fd));
}

export async function setRehire(caseId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd);
  const { body, errors } = rehireForm(fd);
  if (!body) return { errors, values };
  return send('PUT', `/offboarding/cases/${encodeURIComponent(caseId)}/rehire`, body, values);
}

export async function recordInterview(caseId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd);
  const { body, errors } = exitInterviewForm(fd);
  if (!body) return { errors, values };
  return send('PUT', `/offboarding/cases/${encodeURIComponent(caseId)}/exit-interview`, body, values);
}

export async function declineInterview(caseId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const note = fd.get('note');
  return send('POST', `/offboarding/cases/${encodeURIComponent(caseId)}/exit-interview/decline`, { note: typeof note === 'string' && note.trim() ? note.trim() : null });
}

/** Opens a case by hand for an employment (from a former employee's row or a profile), then opens its page. */
export async function openCase(employmentId: string): Promise<FormState> {
  let made: OffboardingCaseView | undefined;
  try {
    made = await apiSend<OffboardingCaseView>('POST', '/offboarding/cases', { employmentId });
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  if (made?.id) redirect(caseHref(made.id));
  return { message: 'Opened.' };
}

export async function saveChecklist(_prev: FormState, fd: FormData): Promise<FormState> {
  const { items } = checklistForm(fd);
  const done = await send('PUT', '/offboarding/checklist', { items }, typedValues(fd));
  if (done.errors) return done;
  redirect(`${OFFBOARDING_CHECKLIST_PATH}?saved=1`);
}

/** The leaver sends their own exit interview. */
export async function sendMyInterview(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd);
  const { body, errors } = exitInterviewForm(fd);
  if (!body) return { errors, values };
  const done = await send('PUT', '/offboarding/my/exit-interview', body, values);
  if (done.errors) return done;
  redirect(`${MY_EXIT_INTERVIEW_PATH}?sent=1`);
}

/** The leaver would rather not do one. */
export async function declineMyInterview(_prev: FormState, fd: FormData): Promise<FormState> {
  const note = fd.get('note');
  const done = await send('POST', '/offboarding/my/exit-interview/decline', { note: typeof note === 'string' && note.trim() ? note.trim() : null });
  if (done.errors) return done;
  redirect(`${MY_EXIT_INTERVIEW_PATH}?declined=1`);
}
