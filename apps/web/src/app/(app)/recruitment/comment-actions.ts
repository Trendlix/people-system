'use server';

// Screening comments (owner, 24 October 2026: "is there a way to add screening comments?", "and i can add genearrl
// comments"; asked, "Yes: Good fit / Maybe / Not a fit" and "HR + hiring manager & interviewers"): adding one (about an
// application, a general CV, or the person in general), its author editing it within 24 hours, and a Super Admin
// deleting it. Each forwards to the API, which checks who may, the mentions and every rule again.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { commentForm, targetBody } from './screening';

/** What was typed, kept to show again after a refusal. */
function typed(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string' && !k.startsWith('$') && k !== 'mentions') out[k] = v;
  return out;
}

async function send(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown, values: Record<string, string> | undefined, said: string): Promise<FormState> {
  try {
    await apiSend(method, path, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, ...(values && { values }) };
    throw err;
  }
  refresh();
  return { message: said };
}

/** A new comment: about the target chosen (`target`: "general", "application:<id>" or "general_cv:<id>"); `candidateId` for a general one. */
export async function addScreeningComment(candidateId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typed(fd);
  const target = targetBody(typeof fd.get('target') === 'string' ? (fd.get('target') as string) : '', candidateId);
  if (!target) return { errors: ['Choose what the comment is about.'], values };
  const { body, errors } = commentForm(fd);
  if (!body) return { errors, values };
  return send('POST', '/recruitment/comments', { ...target, ...body }, values, 'Comment added.');
}

/** The author's change to their comment, within 24 hours of writing it. */
export async function editScreeningComment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typed(fd);
  const { body, errors } = commentForm(fd);
  if (!body) return { errors, values };
  return send('PATCH', `/recruitment/comments/${encodeURIComponent(id)}`, body, values, 'Comment saved.');
}

/** A comment deleted (a Super Admin only). */
export async function deleteScreeningComment(id: string): Promise<FormState> {
  return send('DELETE', `/recruitment/comments/${encodeURIComponent(id)}`, undefined, undefined, 'Comment deleted.');
}
