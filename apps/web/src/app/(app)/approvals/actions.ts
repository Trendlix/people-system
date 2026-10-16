'use server';

// The CEO's decision on an ending HR recorded and approved, and on a pay raise HR sent; and HR's or an Admin's on an
// employee's change request. Each forwards to the API, which lets only the CEO decide endings and raises, and only HR
// and Admin change requests, so calling these directly can't bypass that.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/** Approve (a note is optional) or reject (a note is required), by the button pressed (`decision`). */
export async function decideEnding(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const decision = String(fd.get('decision') ?? '');
  const note = String(fd.get('note') ?? '').trim();
  const values = { note };
  if (decision !== 'approve' && decision !== 'reject') return { errors: ['Choose Approve or Reject.'], values };
  if (decision === 'reject' && !note) return { errors: ['Write a note saying why the ending is rejected.'], values };

  try {
    await apiSend('POST', `/endings/${encodeURIComponent(id)}/${decision}`, note ? { note } : {});
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  // The list (and the count beside Approvals in the sidebar) no longer has it.
  refresh();
  redirect(`/approvals?done=${decision === 'approve' ? 'approved' : 'rejected'}`);
}

/**
 * HR's or an Admin's decision on an employee's request to change their details: approving makes the change (the API
 * checks it as it checks HR's edits, and a refusal leaves the request waiting, with its reason on the card); rejecting
 * needs a note, which the employee sees.
 */
export async function decideChangeRequest(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const decision = String(fd.get('decision') ?? '');
  const note = String(fd.get('note') ?? '').trim();
  const values = { note };
  if (decision !== 'approve' && decision !== 'reject') return { errors: ['Choose Approve or Reject.'], values };
  if (decision === 'reject' && !note) return { errors: ['Write a note saying why the change is rejected: the employee sees it.'], values };

  try {
    await apiSend('POST', `/change-requests/${encodeURIComponent(id)}/${decision}`, note ? { note } : {});
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  // The list (and the count beside Approvals in the sidebar) no longer has it.
  refresh();
  redirect(`/approvals?done=${decision === 'approve' ? 'change-approved' : 'change-rejected'}`);
}

/**
 * The CEO's decision on a pay raise HR sent, or a renewal with new pay (owner's decisions, 16 October 2026: "HR, then
 * the CEO"), by the button pressed (`decision`): approve, which lets HR have it signed; return it to HR, or decline it,
 * each with a reason. Declining deletes the draft and declines the raise request it came from, if any; the raise
 * request follows each decision.
 */
export async function decideRaise(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const decision = String(fd.get('decision') ?? '');
  const reason = String(fd.get('reason') ?? '').trim();
  const values = { reason };
  if (decision !== 'approve' && decision !== 'return' && decision !== 'decline') return { errors: ['Choose Approve, Return to HR or Decline.'], values };
  if (decision === 'return' && !reason) return { errors: ['Write the reason the raise goes back to HR: HR sees it and changes the raise.'], values };
  if (decision === 'decline' && !reason) return { errors: ['Write the reason the raise is declined.'], values };

  try {
    await apiSend('POST', `/raises/${encodeURIComponent(id)}/${decision}`, decision === 'approve' ? {} : { reason });
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  // The list (and the counts beside Approvals and Raise Requests in the sidebar) no longer has it.
  refresh();
  redirect(`/approvals?done=raise-${decision === 'approve' ? 'approved' : decision === 'return' ? 'returned' : 'declined'}`);
}
