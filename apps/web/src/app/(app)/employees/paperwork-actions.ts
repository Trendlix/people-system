'use server';

// Employee file actions: uploading, re-reading and deleting scanned paperwork; finding the national ID card on a scan
// and reading it (for an employee, or for one being added); and deleting a fix learned from HR's corrections.
// Each one forwards to the API, which checks the session and the HR role, so calling these directly can't bypass
// permissions. The API also checks each file by its content; the size is checked here first for a quick answer.
import { refresh } from 'next/cache';
import { PAPERWORK_LABELS } from '@trendlix/shared';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import type { FormState, IdCardPrepared, IdCardReading, IdCardScan } from '@/lib/types';
import { isPaperworkKind, PAPERWORK_MAX_BYTES, TOO_LARGE, type IdPrepareState, type IdReadState, type IdScanState } from './paperwork';

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
  // the number printed on the paper and when it expires, both optional (they can be set later too)
  const dateErrors: string[] = [];
  const expiresOn = dateFrom(fd, 'expiresOn', 'expiry date', dateErrors);
  if (dateErrors.length) return { errors: dateErrors };

  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file, file.name);
  const documentNo = String(fd.get('documentNo') ?? '').trim();
  if (documentNo) form.append('documentNo', documentNo);
  if (expiresOn) form.append('expiresOn', expiresOn);
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

/** A national ID scan is one document: its front and back files are deleted together. */
export async function deletePaperworkItems(itemIds: string[]): Promise<FormState> {
  for (const id of itemIds) {
    const errors = await attempt(() => apiSend('DELETE', `/paperwork/${id}`));
    if (errors) {
      refresh();
      return { errors };
    }
  }
  refresh();
  return {};
}

/**
 * The ID card files chosen in the form (front needed, back optional), each a photo or a PDF scan, ready to send; or
 * what is wrong with them. A PDF with both sides may come as the front alone: the API reads its page 2 as the back.
 */
function cardPhotos(fd: FormData): { form: FormData } | { errors: string[] } {
  const front = chosen(fd, 'front');
  const back = chosen(fd, 'back');
  if (!front) return { errors: ['Choose a photo or a PDF scan of the front of the card.'] };
  if (front.size > PAPERWORK_MAX_BYTES || (back && back.size > PAPERWORK_MAX_BYTES)) return { errors: [TOO_LARGE] };

  const form = new FormData();
  form.append('front', front, front.name);
  if (back) form.append('back', back, back.name);
  return { form };
}

const UNREAD = 'The card could not be read. Please try again.';

/**
 * Finds the national ID card on the chosen scans or photos (front needed, back optional; one page often holds both
 * sides): each card cut out and set straight, and the pages, to frame a card by hand. The API stores nothing, and what
 * comes back stays in the page.
 */
export async function prepareIdCard(fd: FormData): Promise<IdPrepareState> {
  const photos = cardPhotos(fd);
  if ('errors' in photos) return photos;
  try {
    const prepared = await apiUpload<IdCardPrepared>('POST', '/id-card/prepare', photos.form);
    return prepared ? { prepared } : { errors: ['The scan could not be looked at. Please try again.'] };
  } catch (err) {
    // e.g. the OCR service is not running: the API says so
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}

/**
 * Sends the national ID card (the two sides cut out of the scan) to be read. The API keeps the files in the employee file
 * and changes nothing else: the suggestions only fill the identity form, for HR to check and save. They stay in the
 * page, never in a URL.
 */
export async function scanIdCard(employeeId: string, fd: FormData): Promise<IdScanState> {
  const photos = cardPhotos(fd);
  if ('errors' in photos) return photos;
  try {
    const scan = await apiUpload<IdCardScan>('POST', `/employees/${employeeId}/identity/scan`, photos.form);
    return scan ? { scan } : { errors: [UNREAD] };
  } catch (err) {
    // e.g. the OCR service is not running: the API says so, and that the files were still saved
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}

/**
 * Reads a new employee's national ID card (the two sides cut out of the scan), for the Add employee page. The API stores
 * nothing: the cut-out cards stay in the page and go to the employee file once the employee is added. What the card says
 * stays in the page too, never in a URL.
 */
export async function readIdCard(fd: FormData): Promise<IdReadState> {
  const photos = cardPhotos(fd);
  if ('errors' in photos) return photos;
  try {
    const reading = await apiUpload<IdCardReading>('POST', '/employees/read-id-card', photos.form);
    return reading ? { reading } : { errors: [UNREAD] };
  } catch (err) {
    // e.g. the OCR service is not running: the API says so
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}

/** Forgets a fix learned from HR's corrections to card readings (HR and Admin), e.g. one learned by mistake. */
export async function deleteCardCorrection(id: string): Promise<FormState> {
  const errors = await attempt(() => apiSend('DELETE', `/id-card/corrections/${id}`));
  if (errors) return { errors };
  refresh();
  return {};
}
