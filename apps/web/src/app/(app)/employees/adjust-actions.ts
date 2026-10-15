'use server';

// The document adjuster's actions (components/adjust): turning a document into pages to adjust, a chosen file or one
// stored in the employee file (POST /paperwork/prepare), and putting an adjusted file in place of a stored one
// (PUT /paperwork/:itemId/file). Each forwards to the API, which checks the session and the HR role, so calling these
// directly can't bypass permissions; the API also checks each file by its content. Nothing is stored by preparing.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, apiUpload } from '@/lib/api';
import { pagesFrom, type PagesState } from '@/lib/paperwork-pages';
import type { FormState } from '@/lib/types';
import { PAPERWORK_MAX_BYTES, PDF_MAX_BYTES, PDF_TOO_LARGE, TOO_LARGE } from './paperwork';

const UUID = /^[0-9a-f-]{36}$/i;
const PAGED = /^(image\/(jpeg|png|webp)|application\/pdf)$/;
/** What an adjusted document is: a JPEG for one page, a PDF for several. */
const ADJUSTED = /^(image\/jpeg|application\/pdf)$/;
const UNOPENED = 'The document could not be opened to adjust it. Please try again.';
const NOT_FOUND = 'This document is no longer in the employee file. Reload the page.';

/** The file chosen in a form field, or null when none was. */
function chosen(fd: FormData, key: string): File | null {
  const value = fd.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

/** Why a file cannot be turned into pages, or null. A PDF goes through the web app as it is: 4 MB at most. */
function refusal(file: File): string | null {
  if (!PAGED.test(file.type)) return 'Choose a JPG, PNG or WebP photo, or a PDF.';
  if (file.type === 'application/pdf' && file.size > PDF_MAX_BYTES) return PDF_TOO_LARGE;
  if (file.size > PAPERWORK_MAX_BYTES) return TOO_LARGE;
  return null;
}

/** The pages of a file, from the API (a PDF needs the OCR service: the API says when it is down). */
async function pagesOf(file: File): Promise<PagesState> {
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    const pages = pagesFrom(await apiUpload<unknown>('POST', '/paperwork/prepare', form));
    return pages ? { pages } : { errors: [UNOPENED] };
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}

/** The pages of a file chosen in the page and not uploaded yet (field `file`), to adjust before it is uploaded. */
export async function preparePaperworkPages(fd: FormData): Promise<PagesState> {
  const file = chosen(fd, 'file');
  if (!file) return { errors: ['Choose a file to adjust.'] };
  const wrong = refusal(file);
  return wrong ? { errors: [wrong] } : pagesOf(file);
}

/** The pages of a document stored in the employee file: the web server fetches it from the API and has it prepared. */
export async function prepareStoredPages(itemId: string): Promise<PagesState> {
  if (!UUID.test(itemId)) return { errors: [NOT_FOUND] };
  let res: Response;
  try {
    res = await apiFetch(`/paperwork/${itemId}/file`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { errors: [NOT_FOUND] };
  if (res.status === 403) return { errors: ['Only HR can adjust the documents of the employee file.'] };
  if (!res.ok) return { errors: ['The stored file could not be loaded. Please try again.'] };
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!PAGED.test(type)) return { errors: [UNOPENED] };
  const file = new File([await res.arrayBuffer()], type === 'application/pdf' ? 'document.pdf' : 'document.jpg', { type });
  return pagesOf(file);
}

/**
 * Puts the adjusted file (field `file`, a JPEG or a PDF) in place of a stored document's file. The original is not kept;
 * the API reads the new file's text again. The Documents tab then shows the new file's name and size.
 */
export async function replacePaperworkFile(itemId: string, fd: FormData): Promise<FormState> {
  if (!UUID.test(itemId)) return { errors: [NOT_FOUND] };
  const file = chosen(fd, 'file');
  if (!file) return { errors: ['There is no adjusted file to save.'] };
  if (!ADJUSTED.test(file.type)) return { errors: ['The adjusted file must be a JPG picture or a PDF.'] };
  if (file.size > PAPERWORK_MAX_BYTES) return { errors: [TOO_LARGE] };
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    await apiUpload('PUT', `/paperwork/${itemId}/file`, form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.status === 404 ? [NOT_FOUND] : err.messages };
    throw err;
  }
  refresh();
  return { message: 'The adjusted file has replaced the stored one. Its text is being read again.' };
}
