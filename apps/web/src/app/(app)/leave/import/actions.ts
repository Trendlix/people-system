'use server';

// Importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?"): uploading the file (POST /leave/import,
// the file as it is), HR's choice for a person of it (PATCH …/people), a Zoho type's mapping (PATCH …/types), Apply
// (POST …/apply), Undo (POST …/undo) and a Super Admin's Delete (DELETE). Each forwards to the API, which checks the
// role (HR, and the CEO for the C-level people), the file by its content, and whose rows the user applies or undoes, so
// calling these directly can't bypass that.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import type { LeaveImportView } from '@/lib/leave-import-types';
import { ONLY_SUPER_ADMIN_DELETES } from '@/lib/roles';
import type { FormState } from '@/lib/types';
import { apiMessages, UUID } from '../../payroll/actions-common';
import { LEAVE_IMPORT_DELETED_HREF, leaveImportHref, personChoice, typeChoice, uploadProblem } from './import';

const NOT_FOUND = 'This import was not found.';

/** Uploads the chosen file and opens its review. */
export async function uploadLeaveImport(_prev: FormState, fd: FormData): Promise<FormState> {
  const file = fd.get('file');
  const chosen = file instanceof File && file.size > 0 ? file : null;
  const problem = uploadProblem(chosen);
  if (problem) return { errors: [problem] };
  const form = new FormData();
  form.append('file', chosen!, chosen!.name);
  let made: LeaveImportView | undefined;
  try {
    made = await apiUpload<LeaveImportView>('POST', '/leave/import', form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: apiMessages(err) };
    throw err;
  }
  if (!made?.id) return { errors: ['The file was read, but the server sent no review. Reload the page to see the imports.'] };
  refresh();
  redirect(leaveImportHref(made.id));
}

/** Sends a change and shows the review again in place. */
async function change(id: string, method: 'PATCH' | 'POST' | 'DELETE', path: string, body: unknown, message: string): Promise<FormState> {
  if (!UUID.test(id)) return { errors: [NOT_FOUND] };
  try {
    await apiSend(method, `/leave/import/${id}${path}`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: apiMessages(err) };
    throw err;
  }
  refresh();
  return { message };
}

/** Who a person of the file is: an employee (a name confirmed, or someone picked), skip, or undo. */
export async function chooseImportPerson(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const choice = personChoice(fd);
  if (!choice) return { errors: ['Choose the employee from the list.'] };
  return change(id, 'PATCH', '/people', choice, 'skipped' in choice ? 'Skipped.' : choice.employeeId ? 'Saved.' : 'Back to the match by code or name.');
}

/** A Zoho leave type's mapping: the system's type, work-from-home days, skip, or back to the default. */
export async function mapImportType(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const choice = typeChoice(fd);
  if (!choice) return { errors: ['Choose a leave type from the list, work-from-home days, official duty days, or Skip.'] };
  return change(id, 'PATCH', '/types', choice, 'Saved.');
}

/** Applies the rows ready that are the user's. */
export async function applyLeaveImport(id: string): Promise<FormState> {
  return change(id, 'POST', '/apply', undefined, 'Applied.');
}

/** Removes what the import made that the user imports. */
export async function undoLeaveImport(id: string): Promise<FormState> {
  return change(id, 'POST', '/undo', undefined, 'Undone.');
}

/** A Super Admin deletes an import with nothing left of it, then the list says so. */
export async function deleteLeaveImport(id: string): Promise<FormState> {
  if (!UUID.test(id)) return { errors: [NOT_FOUND] };
  try {
    await apiSend('DELETE', `/leave/import/${id}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.status === 403 ? [ONLY_SUPER_ADMIN_DELETES] : apiMessages(err) };
    throw err;
  }
  refresh();
  redirect(LEAVE_IMPORT_DELETED_HREF);
}
