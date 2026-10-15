'use server';

// Actions on the documents generated from templates (the profile's Contracts tab): checking what a template would lack,
// generating a document, marking it printed, uploading its signed copy, verifying it, and deleting it. Each one forwards
// to the API, which checks the session and the role (HR; a Super Admin for deleting), so calling these directly can't
// bypass permissions. Dates are typed as DD/MM/YYYY and sent as YYYY-MM-DD.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, apiSend, apiUpload, messagesOf } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import { deleteRefusal } from '@/lib/session';
import type { DocumentCheck, FormState } from '@/lib/types';
import { PAPERWORK_MAX_BYTES, TOO_LARGE } from '../../paperwork';
import { isMissingRoute, missingLinks, NO_TEMPLATE, NOT_AVAILABLE_ACTION, type CheckResult, type GenerateResult } from './wording';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/** What a refused request says: "not available yet" for an address the server doesn't have, else the API's reason. */
function messagesFor(err: ApiError): string[] {
  if (err.status === 404 && isMissingRoute(err.messages)) return [NOT_AVAILABLE_ACTION];
  return asShown(err.messages);
}

/** Sends the request and shows the change in place (the profile is rendered again); `message` closes a small form. */
async function act(request: () => Promise<unknown>, message: string): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesFor(err) };
    throw err;
  }
  refresh();
  return { message };
}

/**
 * What generating this document would lack (GET …/documents/check), each missing detail with a link to where it is
 * filled in. Nothing is generated.
 */
export async function checkDocument(employeeId: string, slotKey: string, contractId: string | null): Promise<CheckResult> {
  const query = new URLSearchParams({ slotKey });
  if (contractId) query.set('contractId', contractId);
  let res: Response;
  try {
    res = await apiFetch(`/employees/${employeeId}/documents/check?${query}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) {
    // the server's own reason: no published template (or the contract or employee is gone)
    const messages = await messagesOf(res);
    return { errors: isMissingRoute(messages) ? [NOT_AVAILABLE_ACTION] : messages.some((m) => !/^Request failed/.test(m)) ? asShown(messages) : [NO_TEMPLATE] };
  }
  if (!res.ok) return { errors: asShown(await messagesOf(res)) };
  const check = (await res.json()) as Partial<DocumentCheck>;
  return { missing: missingLinks(employeeId, check.missing ?? []), usesRestricted: Boolean(check.usesRestricted) };
}

/** What generating is about: the template slot, the contract version (a contract's documents), what is typed for it. */
export interface GenerateTarget {
  slotKey: string;
  contractId: string | null;
  needsInputs: string[];
}

/**
 * Generates a document from the published template (POST …/documents). Details still missing come back as the list,
 * with their links; generating again keeps the earlier documents.
 */
export async function generateDocument(employeeId: string, target: GenerateTarget, fd: FormData): Promise<GenerateResult> {
  const errors: string[] = [];
  const documentDate = dateFrom(fd, 'documentDate', 'document date', errors);
  const inputs: Record<string, string> = {};
  for (const tag of target.needsInputs) {
    const value = text(fd, tag);
    if (!value) errors.push(tag === 'letter_to' ? 'Enter who the letter is addressed to.' : tag === 'letter_purpose' ? 'Enter the purpose of the letter.' : `Enter the ${tag.replace(/_/g, ' ')}.`);
    else inputs[tag] = value;
  }
  if (errors.length) return { errors };

  const body = {
    slotKey: target.slotKey,
    ...(target.contractId && { contractId: target.contractId }),
    ...(Object.keys(inputs).length > 0 && { inputs }),
    ...(documentDate && { documentDate }),
  };
  try {
    await apiSend('POST', `/employees/${employeeId}/documents`, body);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    // 409: no published template, or the contract version was replaced (the API says which)
    if (err.status === 409 && err.messages.every((m) => /^Request failed/.test(m))) return { errors: [NO_TEMPLATE] };
    if (err.status === 422) {
      // details are missing: the check names them, each with where it is filled in
      const check = await checkDocument(employeeId, target.slotKey, target.contractId);
      if (check.missing?.length) return { missing: check.missing };
    }
    return { errors: messagesFor(err) };
  }
  refresh();
  return { message: 'Generated. Download it below, print it, and upload the signed copy once it is signed.' };
}

/** The document was printed (for signing). */
export async function markPrinted(documentId: string): Promise<FormState> {
  return act(() => apiSend('POST', `/documents/${documentId}/printed`), 'Marked as printed.');
}

/** The signed copy, scanned or photographed: a photo (made smaller in the browser first) or a PDF. */
export async function uploadSignedCopy(documentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const value = fd.get('file');
  const file = value instanceof File && value.size > 0 ? value : null;
  if (!file) return { errors: ['Choose the signed copy: a photo or a PDF scan.'] };
  if (file.size > PAPERWORK_MAX_BYTES) return { errors: [TOO_LARGE] };
  const form = new FormData();
  form.append('file', file, file.name);
  return act(() => apiUpload('POST', `/documents/${documentId}/signed`, form), 'Signed copy uploaded.');
}

/** HR checked the signed copy: complete, and signed by whoever signs it. */
export async function verifyDocument(documentId: string): Promise<FormState> {
  return act(() => apiSend('POST', `/documents/${documentId}/verify`), 'Verified.');
}

/** Deletes a generated document with its signed copy: a Super Admin only (owner's decision, 15 October 2026). */
export async function deleteDocument(documentId: string): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return act(() => apiSend('DELETE', `/documents/${documentId}`), 'Deleted.');
}
