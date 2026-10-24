'use server';

// Suggested From Earlier CVs (owner, 24 October 2026: "Suggest; HR adds", "Yes, HR presses 'Invite to apply'"): adding
// one to the vacancy, inviting one to apply by email (HR confirmed on the page first), dismissing one with an optional
// reason. Each forwards to the API, which checks who may and every rule again.
import { refresh } from 'next/cache';
import type { SuggestionAdded } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { addedText } from './suggestions';

const path = (id: string, then: string) => `/recruitment/suggestions/${encodeURIComponent(id)}/${then}`;

async function send(to: string, body: unknown, said: (answer: unknown) => string): Promise<FormState> {
  let answer: unknown;
  try {
    answer = await apiSend('POST', to, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: said(answer) };
}

/** Add to this vacancy: the application made from the earlier CV, at Applied. */
export async function addSuggestion(id: string): Promise<FormState> {
  return send(path(id, 'add'), {}, (a) => addedText((a as SuggestionAdded | undefined)?.number));
}

/** Invite to apply: the email with the job's apply link. */
export async function inviteSuggestion(id: string): Promise<FormState> {
  return send(path(id, 'invite'), {}, () => 'Invitation sent.');
}

/** Dismiss, with an optional reason: never suggested again for the vacancy. */
export async function dismissSuggestion(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const reason = fd.get('reason');
  return send(path(id, 'dismiss'), { reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null }, () => 'Dismissed.');
}
