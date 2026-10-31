'use server';

// A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"): the employee sends it or cancels it while it waits; HR or an Admin (a C-level person's: the
// CEO or a Super Admin) approves or rejects it, on Approvals or on Details Changes. Each action forwards to the API, which
// lets only the employee themself send or cancel, and only those who decide decide, so calling these directly can't
// bypass that. The API also checks the photo by its content; its size is checked here first for a quick answer.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { detailsChangesHref, readStatus } from '../requests/details-changes/list';
import { ownPhotoHref, PHOTO_MAX_BYTES, PHOTO_TOO_LARGE } from './photo-requests';

/** Sends the photo chosen (made smaller in the browser first) and the note, if any. Back to the Photo page, which shows it waiting. */
export async function sendPhotoRequest(employeeId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const file = fd.get('file');
  const note = String(fd.get('note') ?? '').trim();
  const values = { note };
  if (!(file instanceof File) || file.size === 0) return { errors: ['Choose a photo of yourself to send.'], values };
  if (file.size > PHOTO_MAX_BYTES) return { errors: [PHOTO_TOO_LARGE], values };

  const form = new FormData();
  form.append('file', file, file.name);
  if (note) form.append('note', note);
  try {
    await apiUpload('POST', `/employees/${encodeURIComponent(employeeId)}/photo-requests`, form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  refresh();
  redirect(`${ownPhotoHref(employeeId)}?sent=1`);
}

/** Withdraws the photo while it waits for HR. Back to the Photo page. */
export async function cancelPhotoRequest(employeeId: string, requestId: string): Promise<FormState> {
  try {
    await apiSend('POST', `/photo-requests/${encodeURIComponent(requestId)}/cancel`, {});
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  redirect(`${ownPhotoHref(employeeId)}?cancelled=1`);
}

/** Approve or reject (a note is optional either way), by the button pressed; the decision made, or what to show on the card. */
async function sendPhotoDecision(id: string, fd: FormData): Promise<{ decision: 'approve' | 'reject' } | { state: FormState }> {
  const decision = String(fd.get('decision') ?? '');
  const note = String(fd.get('note') ?? '').trim();
  const values = { note };
  if (decision !== 'approve' && decision !== 'reject') return { state: { errors: ['Choose Approve or Reject.'], values } };
  try {
    await apiSend('POST', `/photo-requests/${encodeURIComponent(id)}/${decision}`, note ? { note } : {});
  } catch (err) {
    if (err instanceof ApiError) return { state: { errors: err.messages, values } };
    throw err;
  }
  // the lists (and the counts beside Approvals and Details Changes in the sidebar) no longer have it waiting
  refresh();
  return { decision };
}

/** The decision on Approvals. */
export async function decidePhotoRequest(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const sent = await sendPhotoDecision(id, fd);
  if ('state' in sent) return sent.state;
  redirect(`/approvals?done=${sent.decision === 'approve' ? 'photo-approved' : 'photo-rejected'}`);
}

/** The same decision on Details Changes, back to it with the status it was showing. */
export async function decideListedPhotoRequest(id: string, status: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const sent = await sendPhotoDecision(id, fd);
  if ('state' in sent) return sent.state;
  redirect(detailsChangesHref(readStatus({ status }), sent.decision === 'approve' ? 'photo-approved' : 'photo-rejected'));
}
