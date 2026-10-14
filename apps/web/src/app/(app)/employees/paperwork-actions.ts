'use server';

// Employee file actions: uploading, re-reading and deleting scanned paperwork, and reading a national ID card (for
// an employee, or for one being added).
// Each one forwards to the API, which checks the session and the HR role, so calling these directly can't bypass
// permissions. The API also checks each file by its content; the size is checked here first for a quick answer.
import { refresh } from 'next/cache';
import { PAPERWORK_LABELS } from '@trendlix/shared';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import type { FormState, IdCardReading, IdCardScan } from '@/lib/types';
import { isPaperworkKind, PAPERWORK_MAX_BYTES, TOO_LARGE, type IdReadState, type IdScanState } from './paperwork';

/** The file chosen in a form field, or null when none was. */
function chosen(fd: FormData, key: string): File | null {
  const value = fd.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

/** Runs the request; the API's messages come back as form errors. */
async function attempt(request: () => Promise<unknown>): Promise<string[] | null> {
  try {
    await request();
    return null;
  } catch (err) {
    if (err instanceof ApiError) return err.messages;
    throw err;
  }
}

export async function uploadPaperwork(employeeId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const kind = String(fd.get('kind') ?? '');
  const file = chosen(fd, 'file');
  if (!isPaperworkKind(kind)) return { errors: ['Choose what kind of document this is.'] };
  if (!file) return { errors: ['Choose a file to upload.'] };
  if (file.size > PAPERWORK_MAX_BYTES) return { errors: [TOO_LARGE] };

  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file, file.name);
  const errors = await attempt(() => apiUpload('POST', `/employees/${employeeId}/paperwork`, form));
  if (errors) return { errors };
  refresh();
  return { message: `${PAPERWORK_LABELS[kind]} uploaded.` };
}

/** Asks the OCR service to read a file's text again (e.g. it was not running when the file was uploaded). */
export async function rereadPaperwork(itemId: string): Promise<FormState> {
  const errors = await attempt(() => apiSend('POST', `/paperwork/${itemId}/ocr`));
  if (errors) return { errors };
  refresh();
  return {};
}

export async function deletePaperwork(itemId: string): Promise<FormState> {
  const errors = await attempt(() => apiSend('DELETE', `/paperwork/${itemId}`));
  if (errors) return { errors };
  refresh();
  return {};
}

/** The ID card photos chosen in the form (front needed, back optional), ready to send; or what is wrong with them. */
function cardPhotos(fd: FormData): { form: FormData } | { errors: string[] } {
  const front = chosen(fd, 'front');
  const back = chosen(fd, 'back');
  if (!front) return { errors: ['Choose a photo of the front of the card.'] };
  if (front.size > PAPERWORK_MAX_BYTES || (back && back.size > PAPERWORK_MAX_BYTES)) return { errors: [TOO_LARGE] };

  const form = new FormData();
  form.append('front', front, front.name);
  if (back) form.append('back', back, back.name);
  return { form };
}

const UNREAD = 'The card could not be read. Please try again.';

/**
 * Sends photos of the national ID card to be read. The API keeps the photos in the employee file and changes
 * nothing else: the suggestions only fill the identity form, for HR to check and save. They stay in the page, never
 * in a URL.
 */
export async function scanIdCard(employeeId: string, _prev: IdScanState, fd: FormData): Promise<IdScanState> {
  const photos = cardPhotos(fd);
  if ('errors' in photos) return photos;
  try {
    const scan = await apiUpload<IdCardScan>('POST', `/employees/${employeeId}/identity/scan`, photos.form);
    return scan ? { scan } : { errors: [UNREAD] };
  } catch (err) {
    // e.g. the OCR service is not running: the API says so, and that the photos were still saved
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}

/**
 * Reads photos of a new employee's national ID card, for the Add employee page. The API stores nothing: the photos
 * stay in the page and go to the employee file once the employee is added. What the card says stays in the page too,
 * never in a URL.
 */
export async function readIdCard(fd: FormData): Promise<IdReadState> {
  const photos = cardPhotos(fd);
  if ('errors' in photos) return photos;
  try {
    const reading = await apiUpload<IdCardReading>('POST', '/employees/read-id-card', photos.form);
    return reading ? { reading } : { errors: [UNREAD] };
  } catch (err) {
    // e.g. the OCR service is not running: the API says so, and that the details can be filled in by hand
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}
