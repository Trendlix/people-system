'use server';

// Raise requests (owner's decisions, 16 October 2026; reworked 17 October 2026: "requesting a raise should have a drop
// list reason first ( Annual Raise - Performance Raise - Counter Offer Raise - etc..) then add requester comment, suggest
// raise amount or percentage, then the approver to Approve - Approve with another raise amount or percentge - Reject, and
// add a comment"): asking for a raise (the employee for themself, their direct manager for a direct report, or HR for
// anyone: a reason from the list, a comment, and a raise suggested as an amount or, from a manager, a percent only), and
// HR's decision on one: approve it as suggested or with another raise, which prepares the raise and sends it to the CEO,
// or reject it, always with a comment. Each forwards to the API, which checks who may ask (and that a manager suggests
// no amount) and that only HR decides, so calling these directly can't bypass that. The whole raise form is the
// Contract section's; the CEO's decision on the raise is on Approvals (approvals/actions.ts).
import { refresh } from 'next/cache';
import { RAISE_FIGURE_KINDS } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { hrDecisionBody, requestBody } from './decisions';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** What was typed, to keep it in the form after a refusal. */
const typed = (fd: FormData, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, text(fd, k)]));

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/**
 * Asks for a raise for the employee: the reason from the list, the comment, and the raise suggested if any.
 * `suggestsAmount`: whether the asker may suggest an amount (the employee and HR); a manager suggests a percent only.
 * The list on the page shows it once sent.
 */
export async function requestRaise(employeeId: string, suggestsAmount: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typed(fd, ['raiseReason', 'comment', 'figureKind', 'figureValue']);
  const errors: string[] = [];
  const body = requestBody(fd, suggestsAmount ? RAISE_FIGURE_KINDS : ['percent'], errors);
  if (errors.length) return { errors, values };

  try {
    await apiSend('POST', `/employees/${encodeURIComponent(employeeId)}/raise-requests`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  // the profile's list (and HR's count beside Raise Requests in the sidebar) now has it
  refresh();
  return { message: 'Raise request sent. HR approves or rejects it, then the CEO decides; each step shows here.' };
}

/**
 * HR's decision on a request with HR, by the choice made (`decision`): approve it as suggested or with another raise
 * (the raise is prepared from it, from the effective date and the way chosen, and sent to the CEO), or reject it; the
 * comment is required. `suggested`: whether the request suggests a raise to approve as it is.
 */
export async function decideRaiseRequest(requestId: string, suggested: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typed(fd, ['decision', 'comment', 'figureKind', 'figureValue', 'way', 'effectiveDate', 'durationMonths']);
  const errors: string[] = [];
  const { decision, body } = hrDecisionBody(fd, errors, suggested);
  if (errors.length) return { errors, values };

  const id = encodeURIComponent(requestId);
  try {
    if (decision === 'reject') await apiSend('POST', `/raise-requests/${id}/decline`, { comment: body.comment });
    else await apiSend('POST', `/raise-requests/${id}/approve`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  refresh();
  return {
    message:
      decision === 'reject'
        ? 'Request rejected. Your comment shows on it.'
        : 'Approved: the raise is prepared from it and sent to the CEO. Each step shows on the request.',
  };
}

/** HR rejects a request with HR, with a comment. A raise prepared from it and not with the CEO goes with it. */
export async function declineRaiseRequest(requestId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { comment: text(fd, 'comment') };
  if (!values.comment) return { errors: ['Write your comment: why the request is rejected.'], values };

  try {
    await apiSend('POST', `/raise-requests/${encodeURIComponent(requestId)}/decline`, { comment: values.comment });
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages), values };
    throw err;
  }
  refresh();
  return { message: 'Request rejected. Your comment shows on it.' };
}
