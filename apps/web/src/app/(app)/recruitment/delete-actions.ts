'use server';

// Deleting an applicant, or a vacancy people applied to (owner, 25 October 2026: "i want to delete this"; asked, "Vacancy
// alone - applicant alone - superadmin only"): what deleting takes with it (the confirmation windows ask before showing
// Delete), deleting one application on its own (from its page, then back to its vacancy; from a vacancy's list or board,
// which refreshes so its counts follow), and deleting a vacancy with its applications, its number typed to confirm. A
// Super Admin only: anyone else is refused before asking; the API refuses them anyway, and says in words why one stays
// on record (hired, an offer sent, an interview to come).
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ApplicationDeletion, VacancyDeletion } from '@trendlix/shared';
import { ApiError, apiFetch, apiSend, messagesOf, signedOutPath } from '@/lib/api';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { APPLICANT_GONE, deletedText, VACANCY_GONE, vacancyDeletePath } from './deletes';
import { VACANCIES_PATH, vacancyHref } from './recruitment';

type Preview<T> = { value?: T; errors?: string[] };

/** A preview, or the API's words; one gone meanwhile (404) said in words, never the 404 page. */
async function preview<T>(path: string, gone: string): Promise<Preview<T>> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (res.status === 401) redirect(await signedOutPath(res));
  if (res.status === 404) return { errors: [gone] };
  if (!res.ok) return { errors: await messagesOf(res) };
  return { value: (await res.json()) as T };
}

/** What deleting the application takes with it, or why it stays. */
export async function applicationDeletionOf(id: string): Promise<Preview<ApplicationDeletion>> {
  return preview<ApplicationDeletion>(`/recruitment/applications/${encodeURIComponent(id)}/deletion`, APPLICANT_GONE);
}

/** What deleting the vacancy takes with it, or which of its applications stay. */
export async function vacancyDeletionOf(id: string): Promise<Preview<VacancyDeletion>> {
  return preview<VacancyDeletion>(`/recruitment/vacancies/${encodeURIComponent(id)}/deletion`, VACANCY_GONE);
}

/**
 * Deletes one application: `back`, from its own page, then its vacancy's page opens; else (a vacancy's list or board) the
 * page refreshes, its counts with it.
 */
export async function deleteApplicant(id: string, number: string, back: { vacancyId: string } | null): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', `/recruitment/applications/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (back) redirect(vacancyHref(back.vacancyId));
  refresh();
  return { message: deletedText(number) };
}

/** Deletes a vacancy, with its applications when it has some (`confirm`: its number, as typed); then the list of vacancies. */
export async function deleteVacancy(id: string, confirm: string | null): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', vacancyDeletePath(id, confirm));
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  redirect(VACANCIES_PATH);
}
