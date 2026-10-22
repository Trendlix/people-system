'use server';

// Recruitment (owner, 22 October 2026: "where will we include the ATS?"): saving a vacancy, moving it on (sent to the
// CEO, approved or sent back by the CEO, held, reopened, closed), deleting one nobody applied to (a Super Admin), and
// moving an applicant (shortlisted, interview, rejected with a reason, restored) or noting on them. Each forwards to
// the API, which checks who may and every rule again.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { VacancyView } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { vacancyForm, vacancyHref, VACANCIES_PATH } from './recruitment';

/** What was typed, kept to show again after a refusal. */
function typed(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string' && !k.startsWith('$')) out[k] = v;
  return out;
}

async function send(method: 'POST' | 'PATCH', path: string, body: unknown, values?: Record<string, string>, said = 'Saved.'): Promise<FormState> {
  try {
    await apiSend(method, path, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, ...(values && { values }) };
    throw err;
  }
  refresh();
  return { message: said };
}

export async function createVacancy(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typed(fd);
  const { body, errors } = vacancyForm(fd, { withQuestions: true });
  if (!body) return { errors, values };
  let made: VacancyView | undefined;
  try {
    made = await apiSend<VacancyView>('POST', '/recruitment/vacancies', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  redirect(made?.id ? vacancyHref(made.id) : VACANCIES_PATH);
}

export async function updateVacancy(id: string, withQuestions: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typed(fd);
  const { body, errors } = vacancyForm(fd, { withQuestions });
  if (!body) return { errors, values };
  try {
    await apiSend('PATCH', `/recruitment/vacancies/${encodeURIComponent(id)}`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  redirect(vacancyHref(id));
}

const MOVES = { submit: 'submit', approve: 'approve', send_back: 'send-back', hold: 'hold', reopen: 'reopen', close: 'close' } as const;

export async function moveVacancy(id: string, move: keyof typeof MOVES, _prev: FormState, fd: FormData): Promise<FormState> {
  const reason = fd.get('reason');
  const body = typeof reason === 'string' && reason.trim() ? { reason: reason.trim() } : {};
  return send('POST', `/recruitment/vacancies/${encodeURIComponent(id)}/${MOVES[move]}`, body, typed(fd));
}

export async function deleteVacancy(id: string): Promise<FormState> {
  try {
    await apiSend('DELETE', `/recruitment/vacancies/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  redirect(VACANCIES_PATH);
}

export async function moveApplicant(id: string, to: 'shortlisted' | 'interview' | 'rejected', _prev: FormState, fd: FormData): Promise<FormState> {
  const reason = fd.get('reason');
  return send('POST', `/recruitment/applications/${encodeURIComponent(id)}/stage`, { to, reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null }, typed(fd));
}

export async function restoreApplicant(id: string): Promise<FormState> {
  return send('POST', `/recruitment/applications/${encodeURIComponent(id)}/restore`, {});
}

export async function saveApplicantNotes(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const notes = fd.get('notes');
  return send('PATCH', `/recruitment/applications/${encodeURIComponent(id)}/notes`, { notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null }, typed(fd));
}
