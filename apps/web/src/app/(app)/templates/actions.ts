'use server';

// Template library actions: uploading a version of a template's file (a draft: a Word file, or an official form as a
// PDF), saving the fields placed on a PDF version or putting its form's standard layout on it, publishing a draft, and
// deleting one (a Super Admin only). Each one
// forwards to the API, which checks the session and the role (HR or Admin; deleting: a Super Admin), reads the file's
// tags (or checks the fields placed) and refuses to publish a draft with unknown or broken ones (or a PDF with no field),
// so calling these directly can't bypass anything. The file's kind and size are checked here first for a quick answer.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { PDF_FIELDS_MAX, TEMPLATE_LANGUAGES, TEMPLATE_SLOTS, type PdfField, type TemplateLanguage } from '@trendlix/shared';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { deleteRefusal } from '@/lib/session';
import type { FormState, TemplateFields, TemplateVersion } from '@/lib/types';
import { fieldsHref, fileProblem, isPdfVersion, NOT_AVAILABLE_ACTION, templateHref } from './wording';

/** What the upload form gets back: the API's messages, or the new draft (whose check the page then shows). */
export type UploadState = FormState & { draft?: { id: string; version: number } };

/** The longest note ("What changed") the form sends. */
const NOTE_MAX = 500;

/** The API's messages, with a 404 (an API from before templates) said plainly. */
function messages(err: ApiError): string[] {
  return err.status === 404 ? [NOT_AVAILABLE_ACTION] : err.messages;
}

const isLanguage = (value: string): value is TemplateLanguage => (TEMPLATE_LANGUAGES as readonly string[]).includes(value);

/**
 * Uploads a version of a slot's file as a draft: a Word file, whose tags the API reads and the page then shows; or a PDF,
 * after which the browser goes on to Place Fields, as its fields are placed before it can be published.
 */
export async function uploadTemplateVersion(slotKey: string, _prev: UploadState, fd: FormData): Promise<UploadState> {
  const slot = TEMPLATE_SLOTS.find((s) => s.key === slotKey);
  if (!slot) return { errors: ['This template is not in the library.'] };
  if (slot.copyOf) return { errors: ["This copy is printed from the official copy's file: upload the file there."] };

  const value = fd.get('file');
  const file = value instanceof File && value.size > 0 ? value : null;
  if (!file) return { errors: ['Choose the Word file (.docx) or the PDF to upload.'] };
  const problem = fileProblem(file);
  if (problem) return { errors: [problem] };

  const language = String(fd.get('language') ?? '');
  if (slot.language === null && !isLanguage(language)) return { errors: ['Choose the language the document is written in.'] };
  const note = String(fd.get('note') ?? '').trim();
  if (note.length > NOTE_MAX) return { errors: [`The note must be ${NOTE_MAX} characters or fewer.`] };

  const form = new FormData();
  form.append('file', file, file.name);
  if (slot.language === null) form.append('language', language);
  if (note) form.append('note', note);
  let draft: TemplateVersion | undefined;
  try {
    draft = await apiUpload<TemplateVersion>('POST', `/templates/${encodeURIComponent(slotKey)}/versions`, form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: messages(err) };
    throw err;
  }
  refresh();
  if (draft && isPdfVersion(draft)) redirect(`${fieldsHref(slotKey, draft.id)}?uploaded=${draft.version}`);
  if (!draft) return { message: 'Draft uploaded: its check is below.' };
  return { message: `Draft v${draft.version} uploaded: its check is below.`, draft: { id: draft.id, version: draft.version } };
}

/**
 * Publishes a draft: new documents are made from it, and the version in use until now is replaced (it stays on record,
 * as do the documents made from it). Back on the template's page, which says so.
 */
export async function publishTemplateVersion(slotKey: string, versionId: string, version: number): Promise<FormState> {
  try {
    await apiSend('POST', `/templates/versions/${encodeURIComponent(versionId)}/publish`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.status === 409 ? ['This version is no longer a draft. Reload the page to see where it stands.'] : messages(err) };
    throw err;
  }
  refresh();
  redirect(`${templateHref(slotKey)}?published=${version}`);
}

/** What Save on Place Fields gets back: the API's messages, or the fields as the API saved them. */
export type FieldsSaveState = { errors?: string[]; fields?: PdfField[] };

/**
 * Saves the fields placed on a PDF version (HR, Admin), all of them at once: the API checks each one (its tag, its page,
 * that it is on the page) and refuses the lot with the reason, naming the field; and it refuses a replaced version.
 */
export async function saveTemplateFields(versionId: string, fields: PdfField[]): Promise<FieldsSaveState> {
  if (!Array.isArray(fields)) return { errors: ['The fields could not be read. Reload the page and try again.'] };
  if (fields.length > PDF_FIELDS_MAX) return { errors: [`A form can have at most ${PDF_FIELDS_MAX} fields.`] };
  let saved: TemplateFields | undefined;
  try {
    saved = await apiSend<TemplateFields>('PUT', `/templates/versions/${encodeURIComponent(versionId)}/fields`, { fields });
  } catch (err) {
    if (err instanceof ApiError) return { errors: messages(err) };
    throw err;
  }
  refresh();
  return { fields: saved?.fields ?? fields };
}

/**
 * Use the standard layout (HR, Admin; owner, 16 October 2026): the API replaces the fields of a PDF version with the
 * layout the system places when its form is uploaded, and answers with them; it refuses a replaced version, and a form
 * it has no standard layout for.
 */
export async function applyStandardLayout(versionId: string): Promise<FieldsSaveState> {
  let applied: TemplateFields | undefined;
  try {
    applied = await apiSend<TemplateFields>('POST', `/templates/versions/${encodeURIComponent(versionId)}/fields/standard`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: messages(err) };
    throw err;
  }
  refresh();
  return Array.isArray(applied?.fields) ? { fields: applied.fields } : { errors: ['The standard layout was applied. Reload the page to see it.'] };
}

/** Renames a version's file (HR, Admin; owner, 15 October 2026): only the name the library shows changes. */
export async function renameTemplateVersion(versionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const fileName = String(fd.get('fileName') ?? '').trim();
  if (!fileName) return { errors: ['Enter the file name.'] };
  try {
    await apiSend('PATCH', `/templates/versions/${encodeURIComponent(versionId)}`, { fileName });
  } catch (err) {
    if (err instanceof ApiError) return { errors: messages(err), values: { fileName } };
    throw err;
  }
  refresh();
  return { message: 'Renamed.' };
}

/** Deletes a version nothing was made from: a Super Admin only (owner's decision, 15 October 2026). */
export async function deleteTemplateVersion(slotKey: string, versionId: string, version: number): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', `/templates/versions/${encodeURIComponent(versionId)}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: messages(err) };
    throw err;
  }
  refresh();
  redirect(`${templateHref(slotKey)}?deleted=${version}`);
}
