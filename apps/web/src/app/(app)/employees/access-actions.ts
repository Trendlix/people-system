'use server';

// The Access tab's and the Employees list's actions (owner, 22 October 2026: "any active employee with active contract
// should have access"; "On the employee profile"). Each one forwards to the API, which checks who may (HR, an Admin, a
// Super Admin; the CEO for a C-level person) and audits it; its refusals show on the forms.
import type { AccessLinkResult, BulkInviteResult, EmployeeAccessView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { FormState } from '@/lib/types';

/** A form's answer, with the link to copy when one was asked for (shown once, never kept). */
export interface LinkState extends FormState {
  link?: string;
  expiresAt?: string;
}

export interface InviteState extends FormState {
  result?: BulkInviteResult;
}

async function send<T>(request: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; state: FormState }> {
  try {
    return { ok: true, value: await request() };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, state: { errors: err.messages } };
    throw err;
  }
}

/** The email they sign in with, work or personal; their account follows, the password unchanged. */
export async function setSignInEmail(employeeId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const choice = String(fd.get('choice') ?? '');
  const r = await send(() => apiSend<EmployeeAccessView>('PUT', `/employees/${employeeId}/access/sign-in-email`, { choice }));
  if (!r.ok) return { ...r.state, values: { choice } };
  refresh();
  return { message: `Saved. They sign in with ${r.value?.signInEmail.email ?? 'it'} from now on, with the same password.` };
}

/** Give access now: their account made at once, nothing sent. */
export async function giveAccessNow(employeeId: string): Promise<FormState> {
  const r = await send(() => apiSend<EmployeeAccessView>('POST', `/employees/${employeeId}/access/account`));
  if (!r.ok) return r.state;
  refresh();
  return { message: 'Their account is made. Send them an invitation when you’re ready.' };
}

/**
 * Give 7 days' grace (owner, 23 October 2026: "Access should be on hold with a 7 days grace period one time granted by
 * the hr"): full access to the end of the 7th day, once in this contract gap, never extended. The API refuses it (with
 * why) when they aren't on Hold, a grace of this gap was used, or it is for oneself.
 */
export async function giveGrace(employeeId: string): Promise<FormState> {
  const r = await send(() => apiSend<EmployeeAccessView>('POST', `/employees/${employeeId}/access/grace`));
  if (!r.ok) return r.state;
  refresh();
  const until = r.value?.standing.grace?.until;
  return { message: until ? `Grace given: full access until the end of ${formatDate(until)}.` : 'Grace given.' };
}

/** An invitation or a password reset: emailed, or a link to copy and send by hand (WhatsApp). */
export async function sendAccessLink(employeeId: string, purpose: 'invite' | 'reset', _prev: LinkState, fd: FormData): Promise<LinkState> {
  const mode = fd.get('mode') === 'copy' ? 'copy' : 'email';
  const r = await send(() => apiSend<AccessLinkResult>('POST', `/employees/${employeeId}/access/${purpose}`, { mode }));
  if (!r.ok) return r.state;
  refresh();
  const sent = r.value!;
  if (sent.link) return { link: sent.link, expiresAt: sent.expiresAt, message: 'Copy the link and send it to them yourself. It is shown only now.' };
  return { expiresAt: sent.expiresAt, message: purpose === 'invite' ? 'Invitation emailed.' : 'Password reset link emailed.' };
}

/** Send invitations from the Employees list: the people chosen, or everyone not invited yet. */
export async function sendInvitations(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const ids = fd.getAll('employeeIds').map(String).filter(Boolean);
  const body = fd.get('all') === '1' ? { allNotInvited: true } : { employeeIds: ids };
  const r = await send(() => apiSend<BulkInviteResult>('POST', '/employees/access/invitations', body));
  if (!r.ok) return r.state;
  refresh();
  const result = r.value!;
  return { result, message: result.sent === 1 ? '1 invitation emailed.' : `${result.sent} invitations emailed.` };
}
