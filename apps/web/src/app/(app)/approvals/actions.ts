'use server';

// The CEO's decision on an ending HR recorded and approved, and on a pay raise HR sent; and HR's or an Admin's on an
// employee's change request, on Approvals or on Details Changes. Each forwards to the API, which lets only the CEO
// decide endings and raises, and only HR and Admin change requests, so calling these directly can't bypass that.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { ceoDecisionBody } from '../raise-requests/decisions';
import { detailsChangesHref, readStatus } from '../requests/details-changes/list';

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
 * Sends HR's or an Admin's decision on an employee's change request: approving makes the change (the API checks it as
 * it checks HR's edits, and a refusal leaves the request waiting, with its reason on the card); rejecting needs a note,
 * which the employee sees. The decision made, or what to show on the card.
 */
async function sendChangeDecision(id: string, fd: FormData): Promise<{ decision: 'approve' | 'reject' } | { state: FormState }> {
  const decision = String(fd.get('decision') ?? '');
  const note = String(fd.get('note') ?? '').trim();
  const values = { note };
  if (decision !== 'approve' && decision !== 'reject') return { state: { errors: ['Choose Approve or Reject.'], values } };
  if (decision === 'reject' && !note) return { state: { errors: ['Write a note saying why the change is rejected: the employee sees it.'], values } };

  try {
    await apiSend('POST', `/change-requests/${encodeURIComponent(id)}/${decision}`, note ? { note } : {});
  } catch (err) {
    if (err instanceof ApiError) return { state: { errors: asShown(err.messages), values } };
    throw err;
  }
  // The lists (and the counts beside Approvals and Details Changes in the sidebar) no longer have it waiting.
  refresh();
  return { decision };
}

/** HR's or an Admin's decision on an employee's request to change their details, on Approvals. */
export async function decideChangeRequest(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const sent = await sendChangeDecision(id, fd);
  if ('state' in sent) return sent.state;
  redirect(`/approvals?done=${sent.decision === 'approve' ? 'change-approved' : 'change-rejected'}`);
}

/**
 * The same decision on the Details Changes page (under Requests), back to it with the status it was showing (`status`,
 * read as the page reads its address: anything else is All).
 */
export async function decideListedChangeRequest(id: string, status: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const sent = await sendChangeDecision(id, fd);
  if ('state' in sent) return sent.state;
  redirect(detailsChangesHref(readStatus({ status }), sent.decision === 'approve' ? 'change-approved' : 'change-rejected'));
}

/**
 * The CEO's decision on a pay raise HR sent, or a renewal with new pay (owner's decisions, 16 October 2026: "HR, then
 * the CEO"; 17 October 2026: "Approve - Approve with another raise amount or percentge - Reject, and add a comment"), by
 * the choice made: approve it as it reached them, or with another raise (its pay changed to it), which lets HR have it
 * signed; reject it, which deletes the draft and rejects the raise request it came from, if any; or return it to HR.
 * Always with a comment. The raise request follows each decision.
 */
export async function decideRaise(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = Object.fromEntries(['decision', 'comment', 'figureKind', 'figureValue'].map((k) => [k, String(fd.get(k) ?? '').trim()]));
  const errors: string[] = [];
  const { choice, path, body } = ceoDecisionBody(fd, errors);
  if (errors.length || !path) return { errors, values };

  try {
    await apiSend('POST', `/raises/${encodeURIComponent(id)}/${path}`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  // The list (and the counts beside Approvals and Raise Requests in the sidebar) no longer has it.
  refresh();
  redirect(`/approvals?done=raise-${choice === 'approve' ? 'approved' : choice === 'approve_other' ? 'approved-other' : choice === 'return' ? 'returned' : 'declined'}`);
}
