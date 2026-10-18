'use server';

// Reimbursement claims (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset
// up conditions"): sending a claim with its receipts (multipart), reading the types again for another expense month
// (what the employee's claims already take of the caps), cancelling a claim while it is being decided, and each
// approver's decision: approve it, approve a lower amount with a comment, or reject it with one. Each forwards to the
// API, which checks who may claim, the type's conditions, who decides each stage and that nobody decides their own
// claim, so calling these directly can't bypass that. Once sent, the employee lands on the claim's page.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ReimbursementStage } from '@trendlix/shared';
import { ApiError, apiFetch, apiSend, apiUpload, messagesOf } from '@/lib/api';
import type { FormState, MyReimbursementType, ReimbursementClaimView } from '@/lib/types';
import { claimForm, typedValues } from './claim';
import { claimDoneHref, decisionBody } from './list';

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/**
 * Sends a claim (POST /me/reimbursements, multipart): the type, the expense's date, the amount, the description and the
 * receipts (`receipts`, photos made smaller in the browser first). What the API finds wrong (a condition of the type)
 * comes back as the form's errors, with what was typed; once sent, its page opens, saying so.
 */
export async function sendClaim(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd);
  const { fields, receipts, errors } = claimForm(fd);
  if (!fields) return { errors, values };

  const form = new FormData();
  form.append('typeId', fields.typeId);
  form.append('expenseDate', fields.expenseDate);
  form.append('amount', fields.amount.toFixed(2));
  form.append('description', fields.description);
  for (const file of receipts) form.append('receipts', file, file.name);
  let claim: ReimbursementClaimView | undefined;
  try {
    claim = await apiUpload<ReimbursementClaimView>('POST', '/me/reimbursements', form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  // My Requests and the manager's count in the sidebar now have it
  refresh();
  redirect(claim?.id ? claimDoneHref(claim.id, 'sent') : '/my-requests');
}

/**
 * The types the employee may claim, with what their claims of each already take of its caps in the month and year of
 * this expense date (YYYY-MM-DD): the form asks again when the date typed moves to another month.
 */
export async function typesForDate(expenseDate: string): Promise<{ types: MyReimbursementType[] } | { errors: string[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) return { errors: ['Enter the date of the expense.'] };
  let res: Response;
  try {
    res = await apiFetch(`/me/reimbursement-types?expenseDate=${expenseDate}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (!res.ok) return { errors: asShown(await messagesOf(res)) };
  try {
    return { types: (await res.json()) as MyReimbursementType[] };
  } catch {
    return { errors: ['The server sent an answer that could not be read.'] };
  }
}

/** The employee cancels their claim while it is being decided (POST /me/reimbursements/:id/cancel); its page says so. */
export async function cancelClaim(claimId: string): Promise<FormState> {
  try {
    await apiSend('POST', `/me/reimbursements/${encodeURIComponent(claimId)}/cancel`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  refresh();
  redirect(claimDoneHref(claimId, 'cancelled'));
}

/**
 * An approver's decision on a claim waiting for them (POST /reimbursements/:id/decide): approve it, approve a lower
 * amount (less than `current`, the amount it is decided on) with a comment, or reject it with one. `stage`: whose
 * decision it is, for what the claim's page says after it. A claim that moved on meanwhile (decided at this stage by
 * someone else, or cancelled) is refused (409): the page then shows where it stands, and says so.
 */
export async function decideClaim(claimId: string, current: number, stage: ReimbursementStage, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { decision: String(fd.get('decision') ?? ''), amount: String(fd.get('amount') ?? ''), comment: String(fd.get('comment') ?? '') };
  const { body, errors } = decisionBody(fd, current);
  if (!body) return { errors, values };

  try {
    await apiSend('POST', `/reimbursements/${encodeURIComponent(claimId)}/decide`, body);
  } catch (err) {
    // decided by someone else, or cancelled, since the page was opened: it shows where the claim stands now, and says so
    if (err instanceof ApiError && err.status === 409) redirect(claimDoneHref(claimId, 'moved'));
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  // the lists and the counts in the sidebar change with it
  refresh();
  redirect(claimDoneHref(claimId, `${stage}_${body.decision}`));
}
