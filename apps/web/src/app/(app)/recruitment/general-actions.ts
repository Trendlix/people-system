'use server';

// General CVs and the bulk upload (owner, 22 October 2026: "i want a proper viweing, what came out of the posted jobs and
// what cam on randomly", "Both"; "is there a way to easy apply from linkedin?" … "why not"): HR's Add a CV, marking one
// reviewed, archiving and restoring it, adding it to a vacancy (its notes are screening comments since 24 October 2026:
// comment-actions.ts); and a batch of CVs uploaded one by one, saved or discarded. Each forwards to the API, which
// checks who may and every rule again.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { CvBatchTarget, CvSaveResult, CvSaveRow, CvUploadView, GeneralCvView } from '@trendlix/shared';
import { ApiError, apiGet, apiSend, apiUpload } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { addCvApiForm, addCvProblems, addCvTypedValues, generalCvHref, uploadsApiPath } from './general';
import { applicantHref } from './recruitment';

const path = (id: string, then = '') => `/recruitment/general-cvs/${encodeURIComponent(id)}${then}`;

async function send(method: 'POST' | 'PATCH', to: string, body: unknown, said = 'Saved.'): Promise<FormState> {
  try {
    await apiSend(method, to, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: said };
}

/** HR's Add a CV: one that came by email, WhatsApp, LinkedIn, in person or by referral; then its page. */
export async function addGeneralCv(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = addCvTypedValues(fd);
  const problems = addCvProblems(fd);
  if (problems.length) return { errors: problems, values };
  let made: GeneralCvView | undefined;
  try {
    made = await apiUpload<GeneralCvView>('POST', '/recruitment/general-cvs', addCvApiForm(fd));
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  redirect(made?.id ? generalCvHref(made.id) : '/recruitment/applicants?tab=general');
}

export async function setGeneralCvStatus(id: string, to: 'review' | 'archive' | 'restore'): Promise<FormState> {
  return send('POST', path(id, `/${to}`), {}, to === 'review' ? 'Marked as reviewed.' : to === 'archive' ? 'Archived.' : 'Restored.');
}

/** Adds a general CV to a vacancy at Applied or Shortlisted: an application made from it; then the applicant's page. */
export async function moveGeneralCv(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const vacancyId = fd.get('vacancyId');
  const stage = fd.get('stage');
  const values = { vacancyId: typeof vacancyId === 'string' ? vacancyId : '', stage: typeof stage === 'string' ? stage : 'applied' };
  if (!values.vacancyId) return { errors: ['Choose the vacancy.'], values };
  let moved: GeneralCvView | undefined;
  try {
    moved = await apiSend<GeneralCvView>('POST', path(id, '/move'), values);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  if (moved?.movedTo) redirect(applicantHref(moved.movedTo.applicationId));
  refresh();
  return { message: 'Added to the vacancy.' };
}

// ---------- the bulk upload ----------

export type UploadResult = { upload: CvUploadView } | { error: string };

/** One CV of a batch (the file as `cv`): read, its row guessed. One a request, so no request is larger than a CV. */
export async function uploadBatchCv(target: CvBatchTarget, fd: FormData): Promise<UploadResult> {
  const cv = fd.get('cv');
  if (!(cv instanceof Blob) || cv.size === 0) return { error: 'Choose a CV, as a PDF or a Word file.' };
  const form = new FormData();
  form.set('cv', cv, cv instanceof File ? cv.name : 'cv');
  try {
    const upload = await apiUpload<CvUploadView>('POST', uploadsApiPath(target), form);
    if (!upload) return { error: 'The server sent an answer that could not be read.' };
    return { upload };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
}

/** The batch as it is now: its scans' rows filled in once the OCR service has read them (22 October 2026). */
export async function readBatch(target: CvBatchTarget): Promise<{ uploads: CvUploadView[] } | { error: string }> {
  try {
    return { uploads: await apiGet<CvUploadView[]>(uploadsApiPath(target)) };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
}

export type BatchSaved = { result: CvSaveResult } | { errors: string[] };

/** Saves the batch's rows as HR checked them: applications at Applied, or general CVs. */
export async function saveBatch(target: CvBatchTarget, rows: CvSaveRow[]): Promise<BatchSaved> {
  try {
    const result = await apiSend<CvSaveResult>('POST', '/recruitment/cv-uploads/save', { ...(target.kind === 'vacancy' && { vacancyId: target.vacancyId }), rows });
    refresh();
    return { result: result ?? { saved: [], skipped: [] } };
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}

/** Discards the batch, or one CV of it. */
export async function discardBatch(target: CvBatchTarget, id?: string): Promise<{ errors?: string[] }> {
  try {
    await apiSend('POST', '/recruitment/cv-uploads/discard', { ...(target.kind === 'vacancy' && { vacancyId: target.vacancyId }), ...(id && { id }) });
    return {};
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}
