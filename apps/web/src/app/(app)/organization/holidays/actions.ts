'use server';

// Organization → Holidays (owner, 16 October 2026: "make holiday a separate tab"; it was a section of Payroll Setup).
// Each action forwards to the API, which checks the session, the role (HR and Admin add and change holidays; only a
// Super Admin deletes, so removes one) and the dates again, so calling these directly can't bypass them.
import { refresh } from 'next/cache';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { deleteRefusal } from '@/lib/session';
import type { FormState, HolidayImportPreview, HolidayImportResult } from '@/lib/types';
import { send, shown, submitted } from '../payroll/replies';
import { holidayBody } from './holidays';
import { importedMessage, importFileProblem } from './import';

const UUID = /^[0-9a-f-]{36}$/i;

/** A new holiday (POST /payroll/holidays). */
export async function addHoliday(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = holidayBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  return send(() => apiSend('POST', '/payroll/holidays', body), fd, `Added ${body.nameEn} on ${formatDate(body.date)}. Runs made or refreshed from now on count it.`);
}

/** A holiday's day or names changed (PATCH /payroll/holidays/:id). */
export async function updateHoliday(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return { errors: ['This holiday was not found.'] };
  const { body, errors } = holidayBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  return send(() => apiSend('PATCH', `/payroll/holidays/${id}`, body), fd, 'Saved.');
}

/** Removes a holiday (a Super Admin only, as every deletion: DELETE /payroll/holidays/:id). */
export async function deleteHoliday(id: string): Promise<FormState> {
  if (!UUID.test(id)) return { errors: ['This holiday was not found.'] };
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return send(() => apiSend('DELETE', `/payroll/holidays/${id}`), null, 'Removed.');
}

/** What the import form gets back: the API's messages, the preview of the chosen file, or the import done. */
export type HolidayImportState = FormState & { preview?: HolidayImportPreview; result?: HolidayImportResult };

const FINGERPRINT = /^[0-9a-f]{64}$/;

/** The answer's messages with their dates as the screens show them (DD/MM/YYYY). */
const shownPreview = <T extends HolidayImportPreview>(answer: T): T => ({ ...answer, problems: answer.problems.map((p) => ({ ...p, message: shown([p.message])[0] })) });

/**
 * Importing a year's holidays from a file (owner's request, 16 October 2026: "allow me to import yearly holiday list"),
 * in two steps on one form. Preview (step=preview) sends the file (POST /payroll/holidays/import/preview) and answers
 * what would happen to each day, nothing saved. Import (step=import) sends the same file again with the preview's
 * fingerprint (POST /payroll/holidays/import): the API reads it again, checks it is the file previewed, and adds the
 * new days, checked against the holidays as they are then. The API checks the role (HR and Admin) and the file by its
 * content; its name and size are checked here first for a quick answer.
 */
export async function importHolidays(prev: HolidayImportState, fd: FormData): Promise<HolidayImportState> {
  const value = fd.get('file');
  const file = value instanceof File && value.size > 0 ? value : null;
  if (!file) return { errors: ['Choose the file to import: the template filled in, as an Excel workbook (.xlsx) or a CSV file (.csv).'] };
  const problem = importFileProblem(file);
  if (problem) return { errors: [problem] };

  const form = new FormData();
  form.append('file', file, file.name);
  const importing = fd.get('step') === 'import';
  if (importing) {
    const fingerprint = String(fd.get('fingerprint') ?? '');
    if (!FINGERPRINT.test(fingerprint)) return { errors: ['Preview the file before importing it.'] };
    form.append('fingerprint', fingerprint);
  }
  try {
    if (!importing) {
      const preview = await apiUpload<HolidayImportPreview>('POST', '/payroll/holidays/import/preview', form);
      return preview ? { preview: shownPreview(preview) } : { errors: ['The file could not be read. Please try again.'] };
    }
    const result = await apiUpload<HolidayImportResult>('POST', '/payroll/holidays/import', form);
    refresh();
    return result ? { result: shownPreview(result), message: importedMessage(result) } : { message: 'Imported.' };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status === 404) return { errors: ['Not available yet: the server can’t import holidays yet.'] };
    // the preview still holds unless the file or the holidays changed since (409): then it is previewed again
    return { errors: shown(err.messages), preview: importing && err.status !== 409 ? prev.preview : undefined };
  }
}
