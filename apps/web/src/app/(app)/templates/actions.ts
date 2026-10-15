'use server';

// Template library actions: uploading a version of a template's Word file (a draft), publishing a draft, deleting one
// (a Super Admin only), and saving the fields mapped in a version as a new draft (Map Fields). Each one forwards to the API, which checks the session and the role (HR or Admin; deleting:
// a Super Admin), reads the file's tags and refuses to publish a draft with unknown or broken ones, so calling these
// directly can't bypass anything. The file's kind and size are checked here first for a quick answer.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { TEMPLATE_LANGUAGES, TEMPLATE_SLOTS, type TemplateLanguage } from '@trendlix/shared';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { deleteRefusal } from '@/lib/session';
import type { FormState, MapFieldsRequest, TemplateVersion } from '@/lib/types';
import { readRequest } from './mapping';
import { fileProblem, NOT_AVAILABLE_ACTION, templateHref } from './wording';

/** What the upload form gets back: the API's messages, or the new draft (whose check the page then shows). */
export type UploadState = FormState & { draft?: { id: string; version: number } };

/** The longest note ("What changed") the form sends. */
const NOTE_MAX = 500;

/** The API's messages, with a 404 (an API from before templates) said plainly. */
function messages(err: ApiError): string[] {
  return err.status === 404 ? [NOT_AVAILABLE_ACTION] : err.messages;
}

const isLanguage = (value: string): value is TemplateLanguage => (TEMPLATE_LANGUAGES as readonly string[]).includes(value);

/** Uploads a version of a slot's Word file as a draft: the API reads its tags, and the page shows their check. */
export async function uploadTemplateVersion(slotKey: string, _prev: UploadState, fd: FormData): Promise<UploadState> {
  const slot = TEMPLATE_SLOTS.find((s) => s.key === slotKey);
  if (!slot) return { errors: ['This template is not in the library.'] };
  if (slot.copyOf) return { errors: ["This copy is printed from the official copy's file: upload the file there."] };

  const value = fd.get('file');
  const file = value instanceof File && value.size > 0 ? value : null;
  if (!file) return { errors: ['Choose the Word file (.docx) to upload.'] };
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

/** Deletes a draft: a Super Admin only (owner's decision, 15 October 2026); a published or replaced version stays. */
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

/**
 * Saves the fields mapped in a version (Map Fields, owner's request of 15 October 2026): the API makes a new draft from
 * the changes (the uploaded file never changes) and checks each one against the file. Back on the template's page, at
 * the new draft's check, which says so; a refusal (400) comes back with the API's messages, and the page keeps the
 * changes.
 */
export async function mapTemplateFields(slotKey: string, versionId: string, _prev: FormState, input: MapFieldsRequest): Promise<FormState> {
  const read = readRequest(input);
  if ('errors' in read) return { errors: read.errors };
  let draft: TemplateVersion | undefined;
  try {
    draft = await apiSend<TemplateVersion>('POST', `/templates/versions/${encodeURIComponent(versionId)}/map`, read.request);
  } catch (err) {
    if (err instanceof ApiError) {
      // Nest's own 404 for a route it doesn't have ("Cannot POST …"): an API from before Map Fields
      if (err.status === 404 && err.messages.some((m) => m.startsWith('Cannot POST'))) return { errors: [NOT_AVAILABLE_ACTION] };
      if (err.status === 404) return { errors: ['This version is no longer there. Go back to the template’s page to see where it stands.'] };
      return { errors: err.messages };
    }
    throw err;
  }
  refresh();
  redirect(draft?.id ? `${templateHref(slotKey)}?mapped=${draft.version}#draft-${encodeURIComponent(draft.id)}` : templateHref(slotKey));
}
